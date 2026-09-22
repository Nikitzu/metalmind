import { describe, expect, it } from 'vitest';
import type { Answer } from './client.js';
import {
  COVERAGE_LEVELS,
  coverageQuestions,
  formatOverlapVerdicts,
  overlapDecision,
  supersedeHint,
  verdictsFromAnswers,
} from './overlap.js';

const ctx = { title: '', kind: 'work', project: null, tags: [], created: null, updated: null };
const candidates = [
  { ...ctx, file: 'Work/a.md', body: 'A body' },
  { ...ctx, file: 'Work/b.md', body: 'B body' },
];

describe('coverageQuestions', () => {
  it('asks one score per candidate keyed by index with the three ordered levels', () => {
    const q = coverageQuestions(candidates);
    expect(Object.keys(q)).toEqual(['c0', 's0', 'c1', 's1']);
    expect(q.s0.type).toBe('noul');
    expect(q.c0.type).toBe('score');
    expect((q.c0 as { criteria: string[] }).criteria).toHaveLength(3);
    expect(COVERAGE_LEVELS).toEqual(['distinct', 'overlaps', 'covered']);
  });
});

describe('verdictsFromAnswers + overlapDecision', () => {
  const answers: Record<string, Answer> = {
    c0: { type: 'score', score: 1.7, probabilities: { '2': 0.8 }, confidence: 0.9 },
    c1: { type: 'score', score: 0.9, probabilities: {}, confidence: 0.8 },
  };
  it('pairs scores, confidence and probabilities with files', () => {
    expect(verdictsFromAnswers(candidates, answers)).toEqual([
      {
        file: 'Work/a.md',
        score: 1.7,
        confidence: 0.9,
        probabilities: { '2': 0.8 },
        supersedes: null,
      },
      { file: 'Work/b.md', score: 0.9, confidence: 0.8, probabilities: {}, supersedes: null },
    ]);
  });
  it('refuses on the highest covered candidate and lists extends', () => {
    const d = overlapDecision(verdictsFromAnswers(candidates, answers));
    expect(d).toEqual({
      refuse: 'Work/a.md',
      uncertain: [],
      extends: ['Work/b.md'],
      supersedes: [],
    });
  });
  it('does not refuse on a covered score with low confidence', () => {
    const d = overlapDecision([
      { file: 'Work/a.md', score: 1.6, confidence: 0.4, probabilities: {}, supersedes: null },
    ]);
    expect(d).toEqual({ refuse: null, uncertain: ['Work/a.md'], extends: [], supersedes: [] });
  });
  it('is silent below 0.5', () => {
    const d = overlapDecision([
      { file: 'Work/a.md', score: 0.2, confidence: 0.9, probabilities: {}, supersedes: null },
    ]);
    expect(d).toEqual({ refuse: null, uncertain: [], extends: [], supersedes: [] });
  });
  it('lists a candidate the draft supersedes at or above 0.7, unless it is the refusing note', () => {
    const d = overlapDecision([
      { file: 'Work/a.md', score: 0.9, confidence: 0.8, probabilities: {}, supersedes: 0.84 },
      { file: 'Work/b.md', score: 0.9, confidence: 0.8, probabilities: {}, supersedes: 0.3 },
      { file: 'Work/c.md', score: 1.8, confidence: 0.9, probabilities: {}, supersedes: 0.95 },
    ]);
    expect(d).toEqual({
      refuse: 'Work/c.md',
      uncertain: [],
      extends: ['Work/a.md', 'Work/b.md'],
      supersedes: ['Work/a.md'],
    });
  });
  it('pairs the supersedes noul with its candidate', () => {
    const v = verdictsFromAnswers([candidates[0]], {
      c0: { type: 'score', score: 0.9, probabilities: {}, confidence: 0.8 },
      s0: { type: 'noul', noul: 0.84 },
    });
    expect(v[0].supersedes).toBe(0.84);
  });
});

describe('formatOverlapVerdicts', () => {
  it('names the covering note with the update command', () => {
    const text = formatOverlapVerdicts(
      { refuse: 'Work/a.md', uncertain: [], extends: [], supersedes: [] },
      [{ file: 'Work/a.md', score: 1.7, confidence: 0.9, probabilities: {}, supersedes: null }],
    );
    expect(text).toContain('covered by Work/a.md (1.70, confidence 0.90)');
    expect(text).toContain('metalmind scribe update work:a');
  });
  it('uses the moc kind for Work/MOCs', () => {
    const text = formatOverlapVerdicts(
      { refuse: 'Work/MOCs/x.md', uncertain: [], extends: [], supersedes: [] },
      [
        {
          file: 'Work/MOCs/x.md',
          score: 1.6,
          confidence: 0.9,
          probabilities: {},
          supersedes: null,
        },
      ],
    );
    expect(text).toContain('metalmind scribe update moc:x');
  });
  it('prints extends lines', () => {
    const text = formatOverlapVerdicts(
      { refuse: null, uncertain: [], extends: ['Work/b.md'], supersedes: [] },
      [{ file: 'Work/b.md', score: 0.9, confidence: 0.8, probabilities: {}, supersedes: null }],
    );
    expect(text).toBe('extends Work/b.md (0.90, confidence 0.80)');
  });
  it('prints an uncertain covered line', () => {
    const text = formatOverlapVerdicts(
      { refuse: null, uncertain: ['Work/a.md'], extends: [], supersedes: [] },
      [{ file: 'Work/a.md', score: 1.6, confidence: 0.4, probabilities: {}, supersedes: null }],
    );
    expect(text).toBe(
      'covered? Work/a.md (1.60, confidence 0.40), low confidence, creating anyway',
    );
  });
  it('prints a supersedes line with the noul probability', () => {
    const text = formatOverlapVerdicts(
      { refuse: null, uncertain: [], extends: ['Work/a.md'], supersedes: ['Work/a.md'] },
      [{ file: 'Work/a.md', score: 0.9, confidence: 0.8, probabilities: {}, supersedes: 0.84 }],
    );
    expect(text).toBe('extends Work/a.md (0.90, confidence 0.80)\nsupersedes Work/a.md (0.84)');
  });
});

describe('supersedeHint', () => {
  it('prints the supersede command with kind shortcuts for both notes', () => {
    expect(supersedeHint('Work/a.md', 'Learnings/b.md')).toBe(
      '  metalmind scribe supersede work:a learning:b',
    );
  });
});
