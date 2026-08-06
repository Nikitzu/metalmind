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
      globalThis.fetch = vi.fn(
        async () => new Response(JSON.stringify({ result: { points_count: 42 } }), { status: 200 }),
      ) as typeof fetch;
      const { checkQdrantCollection } = await import('./doctor.js');
      const res = await checkQdrantCollection();
      expect(res.ok).toBe(true);
      expect(res.detail).toContain('42');
    });

    it('flags empty collection with a reindex remediation', async () => {
      globalThis.fetch = vi.fn(
        async () => new Response(JSON.stringify({ result: { points_count: 0 } }), { status: 200 }),
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
      globalThis.fetch = vi.fn(
        async () =>
          new Response(JSON.stringify({ models: [{ name: 'nomic-embed-text:latest' }] }), {
            status: 200,
          }),
      ) as typeof fetch;
      const { checkOllamaModel } = await import('./doctor.js');
      expect((await checkOllamaModel()).ok).toBe(true);
    });

    it('flags missing embed model with a docker exec hint', async () => {
      globalThis.fetch = vi.fn(
        async () =>
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
      globalThis.fetch = vi.fn(
        async () => new Response(JSON.stringify({ ok: true }), { status: 200 }),
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
        version: 2,
        flavor: 'scadrial',
        vaultPath: join(tmp, 'vault'),
        outputStyle: { installed: null, priorValue: null },
        embeddings: { provider: 'local', baseURL: null },
        recall: { defaultTier: 'fast', httpEndpoint: null },
        verbose: false,
        mcp: { registered: [] },
        hooks: { claudeCode: false },
        memoryRouting: 'vault-only',
        skills: { eodHook: true, notifications: true },
        forge: { groups: {} },
        hosts: ['claude'],
      };
    });

    afterEach(async () => {
      await rm(tmp, { recursive: true, force: true });
    });

    it('ok when both files contain the sentinel block', async () => {
      const block = '<!-- metalmind:managed:begin -->\nstuff\n<!-- metalmind:managed:end -->\n';
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

  describe('checkSupersedeIntegrity', () => {
    let vault: string;

    beforeEach(async () => {
      vault = await mkdtemp(join(tmpdir(), 'mm-doctor-supersede-'));
      await mkdir(join(vault, 'Plans'), { recursive: true });
    });
    afterEach(async () => {
      await rm(vault, { recursive: true, force: true });
    });

    const note = (fm: string) => `---\n${fm}\n---\n\nbody\n`;

    it('ok on a healthy supersede pair', async () => {
      await writeFile(
        join(vault, 'Plans', 'old.md'),
        note('status: superseded\nsuperseded_by: new'),
      );
      await writeFile(join(vault, 'Plans', 'new.md'), note('supersedes: old'));

      const { checkSupersedeIntegrity } = await import('./doctor.js');
      const res = await checkSupersedeIntegrity(vault);
      expect(res.ok).toBe(true);
    });

    it('flags a dangling superseded_by stem', async () => {
      await writeFile(join(vault, 'Plans', 'old.md'), note('superseded_by: gone'));

      const { checkSupersedeIntegrity } = await import('./doctor.js');
      const res = await checkSupersedeIntegrity(vault);
      expect(res.ok).toBe(false);
      expect(res.detail).toContain("superseded_by 'gone' does not resolve");
    });

    it('flags a stale reverse link after --force re-point', async () => {
      await writeFile(join(vault, 'Plans', 'a.md'), note('superseded_by: c'));
      await writeFile(join(vault, 'Plans', 'b.md'), note('supersedes: a'));
      await writeFile(join(vault, 'Plans', 'c.md'), note('supersedes: a'));

      const { checkSupersedeIntegrity } = await import('./doctor.js');
      const res = await checkSupersedeIntegrity(vault);
      expect(res.ok).toBe(false);
      expect(res.detail).toContain("b: claims to supersede 'a', but that note points at 'c'");
    });

    it('flags a supersede cycle', async () => {
      await writeFile(join(vault, 'Plans', 'a.md'), note('superseded_by: b'));
      await writeFile(join(vault, 'Plans', 'b.md'), note('superseded_by: a'));

      const { checkSupersedeIntegrity } = await import('./doctor.js');
      const res = await checkSupersedeIntegrity(vault);
      expect(res.ok).toBe(false);
      expect(res.detail).toContain('supersede cycle');
    });

    it('flags two notes sharing a stem, since pointers resolve by stem', async () => {
      await mkdir(join(vault, 'Work'), { recursive: true });
      await writeFile(join(vault, 'Plans', 'twin.md'), note('status: active'));
      await writeFile(join(vault, 'Work', 'twin.md'), note('status: active'));

      const { checkSupersedeIntegrity } = await import('./doctor.js');
      const res = await checkSupersedeIntegrity(vault);
      expect(res.ok).toBe(false);
      expect(res.detail).toMatch(/twin/);
    });

    it('ok on a vault with no supersede fields at all', async () => {
      await writeFile(join(vault, 'Plans', 'plain.md'), note('status: active'));

      const { checkSupersedeIntegrity } = await import('./doctor.js');
      const res = await checkSupersedeIntegrity(vault);
      expect(res.ok).toBe(true);
    });
  });

  describe('runDeepChecks wiring', () => {
    it('includes both integrity checks in the returned list', async () => {
      const vault = await mkdtemp(join(tmpdir(), 'mm-doctor-wiring-'));
      runCommand.mockResolvedValue(ok(''));
      globalThis.fetch = vi.fn(async () => new Response('{}', { status: 200 })) as typeof fetch;

      const { runDeepChecks } = await import('./doctor.js');
      const checks = await runDeepChecks({
        vaultPath: vault,
        hosts: [],
        forge: { groups: {} },
      } as unknown as Config);

      const names = checks.map((c) => c.name);
      expect(names).toContain('supersede-integrity');
      expect(names).toContain('code-refs-integrity');
      expect(names).toContain('intent-skills');
      expect(names).toContain('graphify-residue');
      await rm(vault, { recursive: true, force: true });
    });
  });

  describe('checkGraphifyResidue', () => {
    beforeEach(() => {
      runCommand.mockReset();
    });

    it('passes when graphify is gone and no repo holds a stale graph', async () => {
      runCommand.mockResolvedValue({ ok: false, stdout: '', stderr: 'not found', exitCode: 127 });
      const { checkGraphifyResidue } = await import('./doctor.js');
      const res = await checkGraphifyResidue({});
      expect(res.ok).toBe(true);
      expect(res.detail).toBe('none');
    });

    it('flags a graphify install that survived the upgrade', async () => {
      runCommand.mockResolvedValue(ok('graphify 0.9.2'));
      const { checkGraphifyResidue } = await import('./doctor.js');
      const res = await checkGraphifyResidue({});
      expect(res.ok).toBe(false);
      expect(res.detail).toContain('graphify still installed');
      expect(res.remediation).toContain('uv tool uninstall graphifyy');
    });

    it('flags a stale graphify-out directory in a registered forge repo', async () => {
      runCommand.mockResolvedValue({ ok: false, stdout: '', stderr: '', exitCode: 127 });
      const repo = await mkdtemp(join(tmpdir(), 'mm-graphify-residue-'));
      await mkdir(join(repo, 'graphify-out'), { recursive: true });
      await writeFile(join(repo, 'graphify-out', 'graph.json'), '{}', 'utf8');

      const { checkGraphifyResidue } = await import('./doctor.js');
      const res = await checkGraphifyResidue({ g: { repos: [repo] } });
      expect(res.ok).toBe(false);
      expect(res.detail).toContain('stale graphify-out');
      expect(res.remediation).toContain(join(repo, 'graphify-out'));
      await rm(repo, { recursive: true, force: true });
    });
  });

  describe('checkIntentSkills', () => {
    let repo: string;

    beforeEach(async () => {
      runCommand.mockReset();
      repo = await mkdtemp(join(tmpdir(), 'mm-doctor-intent-'));
      await mkdir(join(repo, 'node_modules', '.bin'), { recursive: true });
      await writeFile(join(repo, 'node_modules', '.bin', 'intent'), '#!/bin/sh\n', { mode: 0o755 });
    });
    afterEach(async () => {
      await rm(repo, { recursive: true, force: true });
    });

    it('says so when no forge repos are registered', async () => {
      const { checkIntentSkills } = await import('./doctor.js');
      const res = await checkIntentSkills({});
      expect(res.ok).toBe(true);
      expect(res.detail).toContain('no forge repos');
    });

    it('reports skill and package counts with repo names', async () => {
      runCommand.mockResolvedValue(
        ok(
          JSON.stringify({
            packages: [{ name: '@tanstack/db', version: '0.6.17', skillCount: 7 }],
            skills: [{ use: 'a' }, { use: 'b' }],
          }),
        ),
      );
      const { checkIntentSkills } = await import('./doctor.js');
      const res = await checkIntentSkills({ g: { repos: [repo] } });

      expect(res.ok).toBe(true);
      expect(res.detail).toContain('2 skills');
      expect(res.detail).toContain('@tanstack/db');
    });

    it('stays ok and reports skipped when the CLI is unavailable everywhere', async () => {
      const bare = await mkdtemp(join(tmpdir(), 'mm-doctor-bare-'));
      const { checkIntentSkills } = await import('./doctor.js');
      const res = await checkIntentSkills({ g: { repos: [bare] } });

      expect(res.ok).toBe(true);
      expect(res.detail).toMatch(/not available|skipped/i);
      await rm(bare, { recursive: true, force: true });
    });

    it('reports repos that scanned cleanly but expose nothing', async () => {
      runCommand.mockResolvedValue(ok(JSON.stringify({ packages: [], skills: [] })));
      const { checkIntentSkills } = await import('./doctor.js');
      const res = await checkIntentSkills({ g: { repos: [repo] } });

      expect(res.ok).toBe(true);
      expect(res.detail).toContain('no intent-enabled dependencies');
    });
  });

  describe('checkCodeRefsIntegrity', () => {
    let vault: string;
    let repo: string;

    beforeEach(async () => {
      vault = await mkdtemp(join(tmpdir(), 'mm-doctor-coderefs-'));
      repo = await mkdtemp(join(tmpdir(), 'mm-doctor-repo-'));
      await mkdir(join(vault, 'Work'), { recursive: true });
      await writeFile(join(repo, 'a.ts'), 'export function liveSymbol() {}\n');
      runCommand.mockImplementation(async (_cmd, args = []) => {
        const pattern = args.join(' ');
        if (pattern.includes('liveSymbol')) return ok('a.ts');
        return { stdout: '', stderr: '', ok: false, exitCode: 1 };
      });
    });
    afterEach(async () => {
      await rm(vault, { recursive: true, force: true });
      await rm(repo, { recursive: true, force: true });
    });

    it('ok when every ref resolves', async () => {
      const repoName = repo.split('/').pop() as string;
      await writeFile(
        join(vault, 'Work', 'n.md'),
        `---\ncode: ["${repoName}#liveSymbol"]\n---\n\nbody\n`,
      );
      const { checkCodeRefsIntegrity } = await import('./doctor.js');
      const res = await checkCodeRefsIntegrity(vault, { g: { repos: [repo] } });
      expect(res.ok).toBe(true);
    });

    it('flags missing symbols and unregistered repos with note context', async () => {
      const repoName = repo.split('/').pop() as string;
      await writeFile(
        join(vault, 'Work', 'n.md'),
        `---\ncode: ["${repoName}#goneSymbol", "ghost-repo#x"]\n---\n\nbody\n`,
      );
      const { checkCodeRefsIntegrity } = await import('./doctor.js');
      const res = await checkCodeRefsIntegrity(vault, { g: { repos: [repo] } });
      expect(res.ok).toBe(false);
      expect(res.detail).toContain(`Work/n.md: ${repoName}#goneSymbol missing`);
      expect(res.detail).toContain('Work/n.md: ghost-repo#x unresolvable-repo');
    });

    it('caps the detail at five offenders with a +N more suffix and gives remediation', async () => {
      const refs = Array.from({ length: 7 }, (_, i) => `"ghost-repo#sym${i}"`).join(', ');
      await writeFile(join(vault, 'Work', 'many.md'), `---\ncode: [${refs}]\n---\n\nbody\n`);
      const { checkCodeRefsIntegrity } = await import('./doctor.js');
      const res = await checkCodeRefsIntegrity(vault, { g: { repos: [repo] } });
      expect(res.ok).toBe(false);
      expect(res.detail).toContain('+2 more');
      expect(res.remediation).toBeTruthy();
    });

    it('names colliding stems by path rather than dropping one', async () => {
      const repoName = repo.split('/').pop() as string;
      await mkdir(join(vault, 'Plans'), { recursive: true });
      await writeFile(
        join(vault, 'Work', 'dup.md'),
        `---\ncode: ["${repoName}#goneOne"]\n---\n\nbody\n`,
      );
      await writeFile(
        join(vault, 'Plans', 'dup.md'),
        `---\ncode: ["${repoName}#goneTwo"]\n---\n\nbody\n`,
      );
      const { checkCodeRefsIntegrity } = await import('./doctor.js');
      const res = await checkCodeRefsIntegrity(vault, { g: { repos: [repo] } });
      expect(res.ok).toBe(false);
      expect(res.detail).toContain('goneOne');
      expect(res.detail).toContain('goneTwo');
    });

    it('ok on a vault with no code refs', async () => {
      await writeFile(join(vault, 'Work', 'plain.md'), '---\ntitle: x\n---\n\nbody\n');
      const { checkCodeRefsIntegrity } = await import('./doctor.js');
      const res = await checkCodeRefsIntegrity(vault, { g: { repos: [repo] } });
      expect(res.ok).toBe(true);
      expect(res.detail).toContain('no code refs');
    });
  });
});
