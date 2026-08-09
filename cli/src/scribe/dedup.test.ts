import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEDUP_THRESHOLD, findOverlappingNotes, formatOverlapWarning } from './dedup.js';

describe('findOverlappingNotes', () => {
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  const respond = (hits: unknown[]) =>
    vi.fn(
      async () =>
        new Response(JSON.stringify({ hits }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
    ) as typeof fetch;

  it('returns only hits at or above the cosine threshold', async () => {
    globalThis.fetch = respond([
      { file: 'Learnings/dupe.md', score: 0.91, heading: '(root)', text: 't' },
      { file: 'Work/near.md', score: DEDUP_THRESHOLD, heading: '(root)', text: 't' },
      { file: 'Work/far.md', score: 0.42, heading: '(root)', text: 't' },
    ]);

    const hits = await findOverlappingNotes({ title: 'dupe', body: 'body' });

    expect(hits).toEqual([
      { file: 'Learnings/dupe.md', score: 0.91 },
      { file: 'Work/near.md', score: DEDUP_THRESHOLD },
    ]);
  });

  it('queries semantic-only so scores stay cosine, not RRF', async () => {
    const fetchMock = respond([]);
    globalThis.fetch = fetchMock;

    await findOverlappingNotes({ title: 't', body: 'b' });

    const call = (fetchMock as unknown as ReturnType<typeof vi.fn>).mock.calls[0];
    const body = JSON.parse((call[1] as { body: string }).body);
    expect(body.mode).toBe('semantic-only');
  });

  it('returns empty when the watcher is unreachable - create must not fail', async () => {
    globalThis.fetch = vi.fn(async () => {
      throw new Error('ECONNREFUSED');
    }) as typeof fetch;

    await expect(findOverlappingNotes({ title: 't', body: 'b' })).resolves.toEqual([]);
  });

  it('returns empty on a blank draft without calling out', async () => {
    const fetchMock = vi.fn() as typeof fetch;
    globalThis.fetch = fetchMock;

    await expect(findOverlappingNotes({ title: '', body: '  ' })).resolves.toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('formatOverlapWarning', () => {
  it('names each overlapping note with its score and suggests scribe update', () => {
    const text = formatOverlapWarning([{ file: 'Learnings/dupe.md', score: 0.91 }]);
    expect(text).toContain('0.91  Learnings/dupe.md');
    expect(text).toContain('scribe update');
  });
});
