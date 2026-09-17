import { KIND_DIRS } from '../scribe/scribe.js';
import type { Answer, Question } from './client.js';

export const COVERAGE_LEVELS = ['distinct', 'overlaps', 'covered'] as const;
// Expected level at or above 1.5 reads as "covered" more likely than not.
export const REFUSE_AT = 1.5;
export const EXTENDS_AT = 0.5;

export interface Candidate {
  file: string;
  body: string;
}

export interface Verdict {
  file: string;
  score: number;
}

export interface OverlapDecision {
  refuse: string | null;
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
      instructions: `How far does existing note ${i} (state.candidates[${i}]) already cover the draft (state.draft)? Judge substance, not wording.`,
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
    return a && a.type === 'score' ? [{ file: c.file, score: a.score }] : [];
  });
}

export function overlapDecision(verdicts: Verdict[]): OverlapDecision {
  const covered = verdicts.filter((v) => v.score >= REFUSE_AT).sort((a, b) => b.score - a.score);
  const extendsList = verdicts
    .filter((v) => v.score >= EXTENDS_AT && v.score < REFUSE_AT)
    .map((v) => v.file);
  return { refuse: covered[0]?.file ?? null, extends: extendsList };
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
  const score = (file: string) => (verdicts.find((v) => v.file === file)?.score ?? 0).toFixed(2);
  const lines: string[] = [];
  if (decision.refuse) {
    lines.push(`covered by ${decision.refuse} (${score(decision.refuse)})`);
    lines.push(`  metalmind scribe update ${shortcut(decision.refuse)}`);
  }
  for (const f of decision.extends) lines.push(`extends ${f} (${score(f)})`);
  return lines.join('\n');
}
