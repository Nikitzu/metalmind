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
import {
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
}

export async function gateDraft(
  opts: { title: string; body: string; exclude: string[] } & GateDeps,
): Promise<GateResult> {
  const hits = (await opts.search(opts.title, opts.body))
    .filter((h) => !opts.exclude.includes(h.file))
    .slice(0, MAX_CANDIDATES);
  if (hits.length === 0) return { refuse: null, lines: [], judged: true };
  const candidates = await Promise.all(
    hits.map(async (h) => ({ file: h.file, body: clipForState(await opts.readNote(h.file)) })),
  );
  const res = await opts.judge({
    state: { draft: { title: opts.title, body: clipForState(opts.body) }, candidates },
    questions: coverageQuestions(candidates),
  });
  if (!res.answers) return { refuse: null, lines: [unjudgedLine(res)], judged: false };
  const verdicts = verdictsFromAnswers(candidates, res.answers);
  const decision = overlapDecision(verdicts);
  const text = formatOverlapVerdicts(decision, verdicts);
  return { refuse: decision.refuse, lines: text ? text.split('\n') : [], judged: true };
}

export function realGateDeps(opts: {
  vaultRoot: string;
  httpEndpoint: string | null;
  model: string;
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
  };
}
