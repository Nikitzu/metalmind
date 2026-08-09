import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { RECALL_TOKEN_HEADER, recallAuthHeaders } from './recall-token.js';
import { recall } from './recall.js';

describe('recallAuthHeaders', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'mm-token-'));
  });

  afterEach(async () => {
    delete process.env.METALMIND_RECALL_TOKEN_PATH;
    await rm(dir, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  it('reads the token file and returns the header', async () => {
    const path = join(dir, 'recall-token');
    await writeFile(path, 'abc123\n');
    process.env.METALMIND_RECALL_TOKEN_PATH = path;

    await expect(recallAuthHeaders()).resolves.toEqual({ [RECALL_TOKEN_HEADER]: 'abc123' });
  });

  it('returns no headers when the file is absent - grace mode carries the call', async () => {
    process.env.METALMIND_RECALL_TOKEN_PATH = join(dir, 'missing');

    await expect(recallAuthHeaders()).resolves.toEqual({});
  });

  it('recall attaches the token header to /search', async () => {
    const path = join(dir, 'recall-token');
    await writeFile(path, 'tok-999\n');
    process.env.METALMIND_RECALL_TOKEN_PATH = path;

    const fetchMock = vi.fn(
      async () =>
        new Response(JSON.stringify({ hits: [] }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
    ) as typeof fetch;
    const original = globalThis.fetch;
    globalThis.fetch = fetchMock;
    try {
      await recall({ vaultPath: '/tmp/vault', query: 'q', tier: 'fast' });
    } finally {
      globalThis.fetch = original;
    }

    const call = (fetchMock as unknown as ReturnType<typeof vi.fn>).mock.calls[0];
    const headers = (call[1] as { headers: Record<string, string> }).headers;
    expect(headers[RECALL_TOKEN_HEADER]).toBe('tok-999');
  });
});
