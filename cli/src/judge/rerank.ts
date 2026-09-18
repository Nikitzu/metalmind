import { clipForState, type JudgeResult, type Question, unjudgedLine } from './client.js';
import { noteContext } from './context.js';

export const RELEVANCE_LEVELS = ['off-topic', 'related', 'answers'] as const;
export type RelevanceLevel = (typeof RELEVANCE_LEVELS)[number];
// Expected level below "related" is noise; at or above 1.5 it more likely answers than not.
export const KEEP_AT = 1.0;
export const ANSWERS_AT = 1.5;
// The watcher's default is 5; ten gives the judge a tail to drop.
export const JUDGED_FETCH_K = 10;

type Hit = Record<string, unknown>;

export interface JudgedHits {
  hits: Hit[];
  kept: number;
  total: number;
  judged: boolean;
  unjudgedLine?: string;
  results: JudgeResult[];
  latency_ms: number;
}

/** batched: every hit in one request (cheap, answers may see each other);
 *  each: one request per hit (independent, as the TypeSafe rerank cookbook does). */
export type JudgeMode = 'batched' | 'each';

export function judgeMode(): JudgeMode {
  return process.env.METALMIND_JUDGE_MODE === 'each' ? 'each' : 'batched';
}

const CRITERIA = [
  'off-topic: the excerpt does not concern what the query asks about',
  'related: same subject as the query, but it does not answer it',
  'answers: the excerpt answers the query directly, or contains the fact, decision or number asked for',
];

export function relevanceQuestions(hits: Hit[], single?: number): Record<string, Question> {
  const questions: Record<string, Question> = {};
  hits.forEach((_, i) => {
    questions[`h${i}`] = {
      type: 'score',
      instructions:
        single === undefined
          ? `How well does excerpt ${i} (state.hits[${i}]) answer state.query? Its kind, project, tags and date are context, not the answer.`
          : 'How well does state.hit answer state.query? Its kind, project, tags and date are context, not the answer.',
      criteria: CRITERIA,
    };
  });
  return questions;
}

// A note's first chunk is mostly frontmatter; stripped bare it reads as empty and
// scores off-topic, so the title travels with the text.
export async function excerptForJudge(
  h: Hit,
  readNote?: (file: string) => Promise<string>,
): Promise<{
  file: unknown;
  title: string;
  kind: string;
  project: string | null;
  tags: string[];
  updated: string | null;
  heading: unknown;
  text: string;
}> {
  const raw = String(h.text ?? '');
  const chunkTitle = /^title:\s*"?(.+?)"?\s*$/m.exec(raw)?.[1] ?? '';
  let text = clipForState(raw);
  let ctx = {
    title: chunkTitle,
    kind: '',
    project: null as string | null,
    tags: [] as string[],
    updated: null as string | null,
  };
  if (readNote && typeof h.file === 'string') {
    const note = await readNote(h.file).catch(() => '');
    if (note) {
      const c = noteContext(note, h.file);
      ctx = {
        title: c.title || chunkTitle,
        kind: c.kind,
        project: c.project,
        tags: c.tags,
        updated: c.updated,
      };
      if (!text.trim()) text = c.body;
    }
  }
  return { file: h.file, ...ctx, heading: h.heading, text };
}

function level(score: number): RelevanceLevel {
  if (score >= ANSWERS_AT) return 'answers';
  if (score >= KEEP_AT) return 'related';
  return 'off-topic';
}

export async function judgeHits(opts: {
  query: string;
  hits: Hit[];
  k: number;
  judge: (o: { state: unknown; questions: Record<string, Question> }) => Promise<JudgeResult>;
  readNote?: (file: string) => Promise<string>;
  mode?: JudgeMode;
}): Promise<JudgedHits> {
  const fallback = opts.hits.slice(0, opts.k);
  const none = { results: [] as JudgeResult[], latency_ms: 0 };
  if (opts.hits.length === 0) return { hits: fallback, kept: 0, total: 0, judged: true, ...none };
  const excerpts = await Promise.all(opts.hits.map((h) => excerptForJudge(h, opts.readNote)));
  const started = Date.now();
  const mode = opts.mode ?? judgeMode();
  const results =
    mode === 'each'
      ? await Promise.all(
          excerpts.map((e, i) =>
            opts.judge({
              state: { query: opts.query, hit: e },
              questions: { [`h${i}`]: relevanceQuestions([e as unknown as Hit], i).h0 as Question },
            }),
          ),
        )
      : [
          await opts.judge({
            state: { query: opts.query, hits: excerpts },
            questions: relevanceQuestions(opts.hits),
          }),
        ];
  const latency_ms = Date.now() - started;
  const failed = results.find((r) => !r.answers);
  if (failed && results.every((r) => !r.answers)) {
    return {
      hits: fallback,
      kept: 0,
      total: opts.hits.length,
      judged: false,
      unjudgedLine: unjudgedLine(failed),
      results,
      latency_ms,
    };
  }
  const answerFor = (i: number) =>
    mode === 'each' ? results[i]?.answers?.[`h${i}`] : results[0]?.answers?.[`h${i}`];
  const scored = opts.hits.map((h, i) => {
    const a = answerFor(i);
    const score = a && a.type === 'score' ? a.score : 0;
    return { hit: { ...h, judge: { score, level: level(score) } }, score, i };
  });
  const kept = scored
    .filter((s) => s.score >= KEEP_AT)
    .sort((a, b) => b.score - a.score || a.i - b.i)
    .map((s) => s.hit);
  const tail = { results, latency_ms };
  if (kept.length === 0)
    return { hits: fallback, kept: 0, total: opts.hits.length, judged: true, ...tail };
  return {
    hits: kept.slice(0, opts.k),
    kept: kept.length,
    total: opts.hits.length,
    judged: true,
    ...tail,
  };
}

export function formatJudgedTail(r: Pick<JudgedHits, 'kept' | 'total' | 'judged'>): string {
  if (!r.judged) return '';
  if (r.kept === 0) return `judged: 0 of ${r.total} answer this; showing the unjudged top hits`;
  return `judged: ${r.kept} of ${r.total} kept`;
}
