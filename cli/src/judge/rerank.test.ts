import { describe, expect, it, vi } from 'vitest';
import { formatJudgedTail, judgeHits, RELEVANCE_LEVELS, relevanceQuestions } from './rerank.js';

const hits = [
  { file: 'A.md', text: 'alpha', score: 0.5 },
  { file: 'B.md', text: 'beta', score: 0.4 },
  { file: 'C.md', text: 'gamma', score: 0.3 },
];

describe('relevanceQuestions', () => {
  it('asks one score per hit with three levels', () => {
    const q = relevanceQuestions(hits);
    expect(Object.keys(q)).toEqual(['h0', 'h1', 'h2']);
    expect(RELEVANCE_LEVELS).toEqual(['off-topic', 'related', 'answers']);
  });
});

describe('judgeHits', () => {
  it('orders by judged score, drops below 1.0, marks answers, keeps k', async () => {
    const judge = vi.fn(async () => ({
      answers: {
        h0: { type: 'score' as const, score: 0.4, probabilities: {}, confidence: 0.9 },
        h1: { type: 'score' as const, score: 1.8, probabilities: {}, confidence: 0.9 },
        h2: { type: 'score' as const, score: 1.1, probabilities: {}, confidence: 0.9 },
      },
    }));
    const res = await judgeHits({ query: 'q', hits, k: 5, judge });
    expect(res.hits.map((h) => h.file)).toEqual(['B.md', 'C.md']);
    expect(res.hits[0].judge).toEqual({ score: 1.8, level: 'answers' });
    expect(res.hits[1].judge).toEqual({ score: 1.1, level: 'related' });
    expect(res.kept).toBe(2);
    expect(res.total).toBe(3);
    expect(res.judged).toBe(true);
  });

  it('falls back to the original top-k when nothing survives', async () => {
    const judge = vi.fn(async () => ({
      answers: {
        h0: { type: 'score' as const, score: 0.2, probabilities: {}, confidence: 0.9 },
        h1: { type: 'score' as const, score: 0.1, probabilities: {}, confidence: 0.9 },
        h2: { type: 'score' as const, score: 0.0, probabilities: {}, confidence: 0.9 },
      },
    }));
    const res = await judgeHits({ query: 'q', hits, k: 2, judge });
    expect(res.hits.map((h) => h.file)).toEqual(['A.md', 'B.md']);
    expect(res.kept).toBe(0);
    expect(res.judged).toBe(true);
  });

  it('returns the original top-k unjudged on failure', async () => {
    const judge = vi.fn(async () => ({ answers: null, unjudged: 'timeout' as const }));
    const res = await judgeHits({ query: 'q', hits, k: 2, judge });
    expect(res.hits.map((h) => h.file)).toEqual(['A.md', 'B.md']);
    expect(res.judged).toBe(false);
    expect(res.unjudgedLine).toBe('unjudged: timeout');
  });
});

describe('formatJudgedTail', () => {
  it('reports kept of total', () => {
    expect(formatJudgedTail({ kept: 2, total: 10, judged: true })).toBe('judged: 2 of 10 kept');
  });
  it('says none answered when nothing survived', () => {
    expect(formatJudgedTail({ kept: 0, total: 10, judged: true })).toBe(
      'judged: 0 of 10 answer this; showing the unjudged top hits',
    );
  });
});
