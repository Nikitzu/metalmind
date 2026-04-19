import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Config } from '../config.js';
import type { CommandResult } from '../util/exec.js';

const runCommand = vi.hoisted(() =>
  vi.fn<(cmd: string, args?: string[], opts?: { timeoutMs?: number }) => Promise<CommandResult>>(),
);

vi.mock('../util/exec.js', () => ({ runCommand }));

function ok(stdout = ''): CommandResult {
  return { stdout, stderr: '', ok: true, exitCode: 0 };
}

function fail(stderr = 'fail'): CommandResult {
  return { stdout: '', stderr, ok: false, exitCode: 1 };
}

describe('doctor deep checks', () => {
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    runCommand.mockReset();
    originalFetch = globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  describe('checkDockerContainers', () => {
    it('reports both containers running when docker ps lists them', async () => {
      runCommand.mockResolvedValueOnce(ok('metalmind-ollama\nmetalmind-qdrant\nunrelated'));
      const { checkDockerContainers } = await import('./doctor.js');
      const res = await checkDockerContainers();
      expect(res.map((c) => c.ok)).toEqual([true, true]);
      expect(res.map((c) => c.name)).toEqual(['metalmind-ollama', 'metalmind-qdrant']);
    });

    it('flags missing containers with a vault-up remediation', async () => {
      runCommand.mockResolvedValueOnce(ok('something-else'));
      const { checkDockerContainers } = await import('./doctor.js');
      const res = await checkDockerContainers();
      expect(res.every((c) => !c.ok)).toBe(true);
      expect(res[0]?.remediation).toContain('vault-up');
    });

    it('fails gracefully when docker ps itself fails', async () => {
      runCommand.mockResolvedValueOnce(fail('docker daemon down'));
      const { checkDockerContainers } = await import('./doctor.js');
      const res = await checkDockerContainers();
      expect(res).toHaveLength(1);
      expect(res[0]?.ok).toBe(false);
      expect(res[0]?.name).toBe('docker-ps');
    });
  });

  describe('checkQdrantCollection', () => {
    it('ok when collection has points', async () => {
      globalThis.fetch = vi.fn(async () =>
        new Response(JSON.stringify({ result: { points_count: 42 } }), { status: 200 }),
      ) as typeof fetch;
      const { checkQdrantCollection } = await import('./doctor.js');
      const res = await checkQdrantCollection();
      expect(res.ok).toBe(true);
      expect(res.detail).toContain('42');
    });

    it('flags empty collection with a reindex remediation', async () => {
      globalThis.fetch = vi.fn(async () =>
        new Response(JSON.stringify({ result: { points_count: 0 } }), { status: 200 }),
      ) as typeof fetch;
      const { checkQdrantCollection } = await import('./doctor.js');
      const res = await checkQdrantCollection();
      expect(res.ok).toBe(false);
      expect(res.remediation).toContain('metalmind-vault-rag-indexer');
    });

    it('flags missing collection on 404', async () => {
      globalThis.fetch = vi.fn(async () => new Response('', { status: 404 })) as typeof fetch;
      const { checkQdrantCollection } = await import('./doctor.js');
      const res = await checkQdrantCollection();
      expect(res.ok).toBe(false);
      expect(res.detail).toContain('404');
    });

    it('reports unreachable when fetch throws', async () => {
      globalThis.fetch = vi.fn(async () => {
        throw new Error('ECONNREFUSED');
      }) as typeof fetch;
      const { checkQdrantCollection } = await import('./doctor.js');
      const res = await checkQdrantCollection();
      expect(res.ok).toBe(false);
      expect(res.detail).toContain('unreachable');
      expect(res.remediation).toContain('vault-up');
    });
  });

  describe('checkOllamaModel', () => {
    it('ok when nomic-embed-text is present', async () => {
      globalThis.fetch = vi.fn(async () =>
        new Response(
          JSON.stringify({ models: [{ name: 'nomic-embed-text:latest' }] }),
          { status: 200 },
        ),
      ) as typeof fetch;
      const { checkOllamaModel } = await import('./doctor.js');
      expect((await checkOllamaModel()).ok).toBe(true);
    });

    it('flags missing embed model with a docker exec hint', async () => {
      globalThis.fetch = vi.fn(async () =>
        new Response(JSON.stringify({ models: [{ name: 'llama3:8b' }] }), { status: 200 }),
      ) as typeof fetch;
      const { checkOllamaModel } = await import('./doctor.js');
      const res = await checkOllamaModel();
      expect(res.ok).toBe(false);
      expect(res.remediation).toContain('ollama pull nomic-embed-text');
    });
  });

  describe('checkRecallHttp', () => {
    it('ok when /health returns 200', async () => {
      globalThis.fetch = vi.fn(async () =>
        new Response(JSON.stringify({ ok: true }), { status: 200 }),
      ) as typeof fetch;
      const { checkRecallHttp } = await import('./doctor.js');
      expect((await checkRecallHttp()).ok).toBe(true);
    });

    it('flags unreachable endpoint with a watcher-status remediation', async () => {
      globalThis.fetch = vi.fn(async () => {
        throw new Error('ECONNREFUSED');
      }) as typeof fetch;
      const { checkRecallHttp } = await import('./doctor.js');
      const res = await checkRecallHttp();
      expect(res.ok).toBe(false);
      expect(res.detail).toContain('fall back to stdio');
      expect(res.remediation).toContain('vault-watcher-status');
    });
  });

  describe('checkClaudeMdSentinel', () => {
    let tmp: string;
    let config: Config;

    beforeEach(async () => {
      tmp = await mkdtemp(join(tmpdir(), 'metalmind-doctor-'));
      process.env.HOME = tmp;
      await mkdir(join(tmp, '.claude'), { recursive: true });
      await mkdir(join(tmp, 'vault'), { recursive: true });
      config = {
        version: 1,
        flavor: 'scadrial',
        vaultPath: join(tmp, 'vault'),
        graphifyCmd: 'graphify',
        outputStyle: { installed: null, priorValue: null },
        embeddings: { provider: 'local', baseURL: null },
        recall: { defaultTier: 'fast' },
        verbose: false,
        mcp: { registered: [] },
        hooks: { claudeCode: false },
        memoryRouting: 'vault-only',
        forge: { groups: {} },
      };
    });

    afterEach(async () => {
      await rm(tmp, { recursive: true, force: true });
    });

    it('ok when both files contain the sentinel block', async () => {
      const block =
        '<!-- metalmind:managed:begin -->\nstuff\n<!-- metalmind:managed:end -->\n';
      await writeFile(join(tmp, '.claude', 'CLAUDE.md'), block, 'utf8');
      await writeFile(join(tmp, 'vault', 'CLAUDE.md'), block, 'utf8');
      const { checkClaudeMdSentinel } = await import('./doctor.js');
      const res = await checkClaudeMdSentinel(config);
      expect(res).toHaveLength(2);
      expect(res.every((c) => c.ok)).toBe(true);
    });

    it('flags files that exist but lack the block', async () => {
      await writeFile(join(tmp, '.claude', 'CLAUDE.md'), '# my notes only\n', 'utf8');
      await writeFile(join(tmp, 'vault', 'CLAUDE.md'), '# vault notes\n', 'utf8');
      const { checkClaudeMdSentinel } = await import('./doctor.js');
      const res = await checkClaudeMdSentinel(config);
      expect(res.every((c) => !c.ok)).toBe(true);
      expect(res[0]?.remediation).toContain('burn brass');
    });

    it('flags missing files', async () => {
      const { checkClaudeMdSentinel } = await import('./doctor.js');
      const res = await checkClaudeMdSentinel(config);
      expect(res[0]?.detail).toBe('missing');
      expect(res[1]?.detail).toBe('missing');
    });
  });
});
