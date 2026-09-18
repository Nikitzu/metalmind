import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { type DedupHit, findOverlappingNotes } from '../scribe/dedup.js';
import {
  clipForState,
  type JudgeResult,
  judge as judgeCall,
  type Question,
  unjudgedLine,
} from './client.js';
import { type NoteContext, noteContext } from './context.js';
import { appendJudgeLog, entryFromResult } from './log.js';
import {
  type Candidate,
  coverageQuestions,
  formatOverlapVerdicts,
  overlapDecision,
  verdictsFromAnswers,
} from './overlap.js';

// Below today's 0.80 warning line: the judge decides what a cosine in the sixties means.
export const JUDGED_CANDIDATE_CUT = 0.6;
export const MAX_CANDIDATES = 3;

export interface GateResult {
  refuse: string | null;
  lines: string[];
  judged: boolean;
}

export interface GateDeps {
  search: (title: string, body: string) => Promise<DedupHit[]>;
  readNote: (file: string) => Promise<string>;
  judge: (opts: { state: unknown; questions: Record<string, Question> }) => Promise<JudgeResult>;
  log?: (
    res: JudgeResult,
    files: Record<string, string>,
    decision: string,
    latencyMs: number,
  ) => Promise<void>;
}

export interface Draft {
  title: string;
  body: string;
  kind?: string;
  project?: string;
  tags?: string[];
}

export async function gateDraft(
  opts: { draft: Draft; exclude: string[] } & GateDeps,
): Promise<GateResult> {
  const { draft } = opts;
  const hits = (await opts.search(draft.title, draft.body))
    .filter((h) => !opts.exclude.includes(h.file))
    .slice(0, MAX_CANDIDATES);
  if (hits.length === 0) return { refuse: null, lines: [], judged: true };
  const candidates: Candidate[] = await Promise.all(
    hits.map(async (h) => ({ ...noteContext(await opts.readNote(h.file)), file: h.file })),
  );
  const draftState: Omit<NoteContext, 'file'> = {
    title: draft.title,
    kind: draft.kind ?? '',
    project: draft.project ?? null,
    tags: draft.tags ?? [],
    created: new Date().toISOString().slice(0, 10),
    updated: null,
    body: clipForState(draft.body),
  };
  const started = Date.now();
  const res = await opts.judge({
    state: { draft: draftState, candidates },
    questions: coverageQuestions(candidates),
  });
  const latency = Date.now() - started;
  const files = Object.fromEntries(candidates.map((c, i) => [`c${i}`, c.file]));
  if (!res.answers) {
    await opts.log?.(res, files, 'unjudged', latency);
    return { refuse: null, lines: [unjudgedLine(res)], judged: false };
  }
  const verdicts = verdictsFromAnswers(candidates, res.answers);
  const decision = overlapDecision(verdicts);
  const text = formatOverlapVerdicts(decision, verdicts);
  const summary = decision.refuse
    ? `refused ${decision.refuse}`
    : decision.uncertain.length > 0
      ? `uncertain ${decision.uncertain.join(',')}`
      : decision.extends.length > 0
        ? `extends ${decision.extends.join(',')}`
        : 'distinct';
  await opts.log?.(res, files, summary, latency);
  return { refuse: decision.refuse, lines: text ? text.split('\n') : [], judged: true };
}

export function realGateDeps(opts: {
  vaultRoot: string;
  httpEndpoint: string | null;
  model: string;
  command: 'scribe-create' | 'scribe-update';
  forced?: boolean;
}): GateDeps {
  return {
    search: (title, body) =>
      findOverlappingNotes({
        title,
        body,
        httpEndpoint: opts.httpEndpoint,
        threshold: JUDGED_CANDIDATE_CUT,
      }),
    readNote: (file) => readFile(join(opts.vaultRoot, file), 'utf8'),
    judge: ({ state, questions }) => judgeCall({ state, questions, model: opts.model }),
    log: (res, files, decision, latencyMs) =>
      appendJudgeLog(
        entryFromResult(
          {
            command: opts.command,
            model: opts.model,
            latency_ms: latencyMs,
            decision,
            forced: opts.forced,
          },
          res,
          files,
        ),
      ),
  };
}
