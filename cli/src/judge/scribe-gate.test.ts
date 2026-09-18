import { describe, expect, it, vi } from 'vitest';
import { gateDraft } from './scribe-gate.js';

const search = vi.fn(async () => [{ file: 'Work/a.md', score: 0.7 }]);
const readNote = vi.fn(
  async () => '---\nkind: work\ntitle: A\ntags: ["x"]\ncreated: 2026-09-01\n---\nA body',
);

describe('gateDraft', () => {
  it('refuses when a candidate covers the draft', async () => {
    const judge = vi.fn(async () => ({
      answers: { c0: { type: 'score' as const, score: 1.8, probabilities: {}, confidence: 0.9 } },
    }));
    const log = vi.fn(async () => undefined);
    const res = await gateDraft({
      draft: { title: 't', body: 'b', kind: 'work', tags: ['x'] },
      exclude: [],
      search,
      readNote,
      judge,
      log,
    });
    expect(res.refuse).toBe('Work/a.md');
    expect(res.lines.join('\n')).toContain('covered by Work/a.md');
    const state = (
      judge.mock.calls[0] as unknown as [
        { state: { draft: Record<string, unknown>; candidates: Array<Record<string, unknown>> } },
      ]
    )[0].state;
    expect(state.candidates[0]).toMatchObject({
      file: 'Work/a.md',
      title: 'A',
      kind: 'work',
      tags: ['x'],
      created: '2026-09-01',
      body: 'A body',
    });
    expect(state.draft).toMatchObject({ title: 't', kind: 'work', tags: ['x'], body: 'b' });
    expect(log).toHaveBeenCalledWith(
      expect.anything(),
      { c0: 'Work/a.md' },
      'refused Work/a.md',
      expect.any(Number),
    );
  });

  it('creates with an extends line in the middle band', async () => {
    const judge = vi.fn(async () => ({
      answers: { c0: { type: 'score' as const, score: 1.0, probabilities: {}, confidence: 0.9 } },
    }));
    const res = await gateDraft({
      draft: { title: 't', body: 'b' },
      exclude: [],
      search,
      readNote,
      judge,
    });
    expect(res.refuse).toBeNull();
    expect(res.lines).toEqual(['extends Work/a.md (1.00, confidence 0.90)']);
  });

  it('excludes the target note on update', async () => {
    const judge = vi.fn(async () => ({ answers: {} }));
    const res = await gateDraft({
      draft: { title: 't', body: 'b' },
      exclude: ['Work/a.md'],
      search,
      readNote,
      judge,
    });
    expect(judge).not.toHaveBeenCalled();
    expect(res).toEqual({ refuse: null, lines: [], judged: true });
  });

  it('reports unjudged and never refuses when the judge fails', async () => {
    const judge = vi.fn(async () => ({ answers: null, unjudged: 'offline' as const }));
    const res = await gateDraft({
      draft: { title: 't', body: 'b' },
      exclude: [],
      search,
      readNote,
      judge,
    });
    expect(res).toEqual({ refuse: null, lines: ['unjudged: offline'], judged: false });
  });

  it('skips the judge when the search returns nothing', async () => {
    const judge = vi.fn();
    const res = await gateDraft({
      draft: { title: 't', body: 'b' },
      exclude: [],
      search: async () => [],
      readNote,
      judge,
    });
    expect(judge).not.toHaveBeenCalled();
    expect(res).toEqual({ refuse: null, lines: [], judged: true });
  });
});
