import { KIND_DIRS } from '../scribe/scribe.js';
import type { Answer, Question } from './client.js';
import type { NoteContext } from './context.js';

export const COVERAGE_LEVELS = ['distinct', 'overlaps', 'covered'] as const;
// Expected level at or above 1.5 reads as "covered" more likely than not.
export const REFUSE_AT = 1.5;
export const EXTENDS_AT = 0.5;
// A covered verdict with the probability mass spread across levels is a guess;
// the docs route those to a human, here that means create and say so.
export const REFUSE_CONFIDENCE = 0.6;

export type Candidate = NoteContext & { file: string };

export interface Verdict {
  file: string;
  score: number;
  confidence: number;
  probabilities: Record<string, number>;
}

export interface OverlapDecision {
  refuse: string | null;
  uncertain: string[];
  extends: string[];
}

const CRITERIA = [
  'distinct: the existing note shares words or a subject with the draft and nothing more',
  'overlaps: same subject, but the draft carries a decision, reason, number or condition the existing note lacks',
  'covered: a reader looking for what the draft is about would be satisfied by the existing note; the draft adds nothing they need, even if it is worded, scoped or ordered differently',
];

export function coverageQuestions(candidates: Candidate[]): Record<string, Question> {
  const questions: Record<string, Question> = {};
  candidates.forEach((_, i) => {
    questions[`c${i}`] = {
      type: 'score',
      instructions: `How far does existing note ${i} (state.candidates[${i}]) already cover the draft (state.draft)? Judge substance, not wording; kind, project, tags and dates are context, not the answer.`,
      criteria: CRITERIA,
    };
  });
  return questions;
}

export function verdictsFromAnswers(
  candidates: Candidate[],
  answers: Record<string, Answer>,
): Verdict[] {
  return candidates.flatMap((c, i) => {
    const a = answers[`c${i}`];
    return a && a.type === 'score'
      ? [{ file: c.file, score: a.score, confidence: a.confidence, probabilities: a.probabilities }]
      : [];
  });
}

export function overlapDecision(verdicts: Verdict[]): OverlapDecision {
  const covered = verdicts.filter((v) => v.score >= REFUSE_AT).sort((a, b) => b.score - a.score);
  const sure = covered.filter((v) => v.confidence >= REFUSE_CONFIDENCE);
  const uncertain = covered.filter((v) => v.confidence < REFUSE_CONFIDENCE).map((v) => v.file);
  const extendsList = verdicts
    .filter((v) => v.score >= EXTENDS_AT && v.score < REFUSE_AT)
    .map((v) => v.file);
  return { refuse: sure[0]?.file ?? null, uncertain, extends: extendsList };
}

function shortcut(file: string): string {
  const match = Object.entries(KIND_DIRS)
    .filter(([, dir]) => file.startsWith(`${dir}/`))
    .sort((a, b) => b[1].length - a[1].length)[0];
  if (!match) return file;
  const [kind, dir] = match;
  return `${kind}:${file.slice(dir.length + 1).replace(/\.md$/, '')}`;
}

export function formatOverlapVerdicts(decision: OverlapDecision, verdicts: Verdict[]): string {
  const find = (file: string) => verdicts.find((v) => v.file === file);
  const show = (file: string) => {
    const v = find(file);
    return v ? `${v.score.toFixed(2)}, confidence ${v.confidence.toFixed(2)}` : '';
  };
  const lines: string[] = [];
  if (decision.refuse) {
    lines.push(`covered by ${decision.refuse} (${show(decision.refuse)})`);
    lines.push(`  metalmind scribe update ${shortcut(decision.refuse)}`);
  }
  for (const f of decision.uncertain)
    lines.push(`covered? ${f} (${show(f)}), low confidence, creating anyway`);
  for (const f of decision.extends) lines.push(`extends ${f} (${show(f)})`);
  return lines.join('\n');
}
