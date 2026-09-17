import { clipForState, type JudgeResult, type Question, unjudgedLine } from './client.js';

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
}

const CRITERIA = [
  'off-topic: the excerpt does not concern what the query asks about',
  'related: same subject as the query, but it does not answer it',
  'answers: the excerpt answers the query directly, or contains the fact, decision or number asked for',
];

export function relevanceQuestions(hits: Hit[]): Record<string, Question> {
  const questions: Record<string, Question> = {};
  hits.forEach((_, i) => {
    questions[`h${i}`] = {
      type: 'score',
      instructions: `How well does excerpt ${i} (state.hits[${i}]) answer state.query?`,
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
): Promise<{ file: unknown; title: string; heading: unknown; text: string }> {
  const raw = String(h.text ?? '');
  const title = /^title:\s*"?(.+?)"?\s*$/m.exec(raw)?.[1] ?? '';
  let text = clipForState(raw);
  if (!text.trim() && readNote && typeof h.file === 'string') {
    text = clipForState(await readNote(h.file).catch(() => ''));
  }
  return { file: h.file, title, heading: h.heading, text };
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
}): Promise<JudgedHits> {
  const fallback = opts.hits.slice(0, opts.k);
  if (opts.hits.length === 0) return { hits: fallback, kept: 0, total: 0, judged: true };
  const state = {
    query: opts.query,
    hits: await Promise.all(opts.hits.map((h) => excerptForJudge(h, opts.readNote))),
  };
  const res = await opts.judge({ state, questions: relevanceQuestions(opts.hits) });
  if (!res.answers) {
    return {
      hits: fallback,
      kept: 0,
      total: opts.hits.length,
      judged: false,
      unjudgedLine: unjudgedLine(res),
    };
  }
  const scored = opts.hits.map((h, i) => {
    const a = res.answers?.[`h${i}`];
    const score = a && a.type === 'score' ? a.score : 0;
    return { hit: { ...h, judge: { score, level: level(score) } }, score, i };
  });
  const kept = scored
    .filter((s) => s.score >= KEEP_AT)
    .sort((a, b) => b.score - a.score || a.i - b.i)
    .map((s) => s.hit);
  if (kept.length === 0) return { hits: fallback, kept: 0, total: opts.hits.length, judged: true };
  return { hits: kept.slice(0, opts.k), kept: kept.length, total: opts.hits.length, judged: true };
}

export function formatJudgedTail(r: Pick<JudgedHits, 'kept' | 'total' | 'judged'>): string {
  if (!r.judged) return '';
  if (r.kept === 0) return `judged: 0 of ${r.total} answer this; showing the unjudged top hits`;
  return `judged: ${r.kept} of ${r.total} kept`;
}
