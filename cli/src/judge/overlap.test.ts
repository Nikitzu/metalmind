import { describe, expect, it } from 'vitest';
import type { Answer } from './client.js';
import {
  COVERAGE_LEVELS,
  coverageQuestions,
  formatOverlapVerdicts,
  overlapDecision,
  verdictsFromAnswers,
} from './overlap.js';

const candidates = [
  { file: 'Work/a.md', body: 'A body' },
  { file: 'Work/b.md', body: 'B body' },
];

describe('coverageQuestions', () => {
  it('asks one score per candidate keyed by index with the three ordered levels', () => {
    const q = coverageQuestions(candidates);
    expect(Object.keys(q)).toEqual(['c0', 'c1']);
    expect(q.c0.type).toBe('score');
    expect((q.c0 as { criteria: string[] }).criteria).toHaveLength(3);
    expect(COVERAGE_LEVELS).toEqual(['distinct', 'overlaps', 'covered']);
  });
});

describe('verdictsFromAnswers + overlapDecision', () => {
  const answers: Record<string, Answer> = {
    c0: { type: 'score', score: 1.7, probabilities: {}, confidence: 0.9 },
    c1: { type: 'score', score: 0.9, probabilities: {}, confidence: 0.8 },
  };
  it('pairs scores with files', () => {
    expect(verdictsFromAnswers(candidates, answers)).toEqual([
      { file: 'Work/a.md', score: 1.7 },
      { file: 'Work/b.md', score: 0.9 },
    ]);
  });
  it('refuses on the highest covered candidate and lists extends', () => {
    const d = overlapDecision(verdictsFromAnswers(candidates, answers));
    expect(d).toEqual({ refuse: 'Work/a.md', extends: ['Work/b.md'] });
  });
  it('is silent below 0.5', () => {
    const d = overlapDecision([{ file: 'Work/a.md', score: 0.2 }]);
    expect(d).toEqual({ refuse: null, extends: [] });
  });
});

describe('formatOverlapVerdicts', () => {
  it('names the covering note with the update command', () => {
    const text = formatOverlapVerdicts({ refuse: 'Work/a.md', extends: [] }, [
      { file: 'Work/a.md', score: 1.7 },
    ]);
    expect(text).toContain('covered by Work/a.md (1.70)');
    expect(text).toContain('metalmind scribe update work:a');
  });
  it('uses the moc kind for Work/MOCs', () => {
    const text = formatOverlapVerdicts({ refuse: 'Work/MOCs/x.md', extends: [] }, [
      { file: 'Work/MOCs/x.md', score: 1.6 },
    ]);
    expect(text).toContain('metalmind scribe update moc:x');
  });
  it('prints extends lines', () => {
    const text = formatOverlapVerdicts({ refuse: null, extends: ['Work/b.md'] }, [
      { file: 'Work/b.md', score: 0.9 },
    ]);
    expect(text).toBe('extends Work/b.md (0.90)');
  });
});
