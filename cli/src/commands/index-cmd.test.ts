import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderIndexStatus } from './index-cmd.js';

const CURRENT = {
  stamped: true,
  stale: false,
  expected_format_version: 1,
  expected_embedder: 'BAAI/bge-small-en-v1.5@384',
  format_version: 1,
  embedder: 'BAAI/bge-small-en-v1.5@384',
  chunker: 'heading-split-hard-cut',
  max_chunk_chars: 3500,
  files: 341,
  chunks: 2970,
  built_at: '2026-08-14T09:11:53.604693+00:00',
  bands: { low_edge: 0.7051, high_edge: 0.648 },
};

describe('renderIndexStatus', () => {
  it('shows the format and marks it current', () => {
    const out = renderIndexStatus(CURRENT);

    expect(out).toContain('1');
    expect(out).toContain('current');
  });

  it('reports the counts the index actually holds', () => {
    const out = renderIndexStatus(CURRENT);

    expect(out).toContain('2970');
    expect(out).toContain('341');
  });

  it('shows the confidence bands, which are otherwise only readable as a file', () => {
    const out = renderIndexStatus(CURRENT);

    expect(out).toContain('0.7051');
    expect(out).toContain('0.6480');
  });

  it('says so plainly when the vault has no bands', () => {
    const out = renderIndexStatus({ ...CURRENT, bands: null });

    expect(out).toContain('not calibrated');
    expect(out).not.toContain('0.7051');
  });

  it('names both formats and the fix when the index is stale', () => {
    const out = renderIndexStatus({
      ...CURRENT,
      stale: true,
      format_version: 1,
      expected_format_version: 2,
    });

    expect(out.toLowerCase()).toContain('stale');
    expect(out).toContain('index rebuild');
    expect(out).toContain('2');
  });

  it('flags an embedder change as the reason when the format matches', () => {
    const out = renderIndexStatus({
      ...CURRENT,
      stale: true,
      embedder: 'nomic-embed-text@768',
    });

    expect(out).toContain('nomic-embed-text@768');
    expect(out).toContain('BAAI/bge-small-en-v1.5@384');
  });

  it('reports an unstamped index as pending rather than broken', () => {
    const out = renderIndexStatus({
      ...CURRENT,
      stamped: false,
      stale: false,
      format_version: null,
      embedder: null,
      files: null,
      chunks: null,
      built_at: null,
    });

    expect(out).toContain('not stamped');
    expect(out.toLowerCase()).not.toContain('stale');
  });
});

describe('index status transport', () => {
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it('reports an absent watcher as unreachable rather than throwing', async () => {
    globalThis.fetch = vi.fn(async () => {
      throw new Error('ECONNREFUSED');
    }) as unknown as typeof fetch;

    const { fetchIndexStatus } = await import('./index-cmd.js');

    expect(await fetchIndexStatus()).toEqual({ ok: false, reason: 'unreachable' });
  });

  it('distinguishes a watcher too old to have the endpoint', async () => {
    // A running watcher from an earlier release 404s here. Calling that
    // "could not reach the watcher" sends the user to diagnose a live process.
    globalThis.fetch = vi.fn(
      async () => new Response('{"error":"not found"}', { status: 404 }),
    ) as unknown as typeof fetch;

    const { fetchIndexStatus } = await import('./index-cmd.js');

    expect(await fetchIndexStatus()).toEqual({ ok: false, reason: 'unsupported' });
  });

  it('returns the payload when the watcher answers', async () => {
    globalThis.fetch = vi.fn(
      async () =>
        new Response(JSON.stringify(CURRENT), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
    ) as unknown as typeof fetch;

    const { fetchIndexStatus } = await import('./index-cmd.js');

    expect(await fetchIndexStatus()).toMatchObject({ ok: true, status: { chunks: 2970 } });
  });
});
