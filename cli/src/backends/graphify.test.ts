import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CommandResult } from '../util/exec.js';

const runCommand = vi.hoisted(() =>
  vi.fn<(cmd: string, args?: string[], opts?: { timeoutMs?: number }) => Promise<CommandResult>>(),
);

vi.mock('../util/exec.js', () => ({ runCommand }));

function ok(stdout = ''): CommandResult {
  return { stdout, stderr: '', ok: true, exitCode: 0 };
}

describe('graphify backend', () => {
  let tmp: string;

  beforeEach(async () => {
    tmp = await mkdtemp(join(tmpdir(), 'metalmind-graphify-'));
    runCommand.mockReset();
  });

  afterEach(async () => {
    await rm(tmp, { recursive: true, force: true });
  });

  it('findRepoRoot walks up to the first .git directory', async () => {
    const repo = join(tmp, 'repo');
    await mkdir(join(repo, '.git'), { recursive: true });
    await mkdir(join(repo, 'sub', 'nested'), { recursive: true });

    const { findRepoRoot } = await import('./graphify.js');
    expect(findRepoRoot({ startDir: join(repo, 'sub', 'nested') })).toBe(repo);
  });

  it('findRepoRoot returns null when no .git found', async () => {
    const { findRepoRoot } = await import('./graphify.js');
    expect(findRepoRoot({ startDir: tmp })).toBeNull();
  });

  it('hasGraph detects graphify-out/graph.json', async () => {
    await mkdir(join(tmp, 'graphify-out'), { recursive: true });
    await writeFile(join(tmp, 'graphify-out', 'graph.json'), '{}', 'utf8');
    const { hasGraph } = await import('./graphify.js');
    expect(hasGraph(tmp)).toBe(true);
  });

  it('graphifyQuery invokes graphify with --graph pointing at repo', async () => {
    runCommand.mockResolvedValueOnce(ok('auth-flow.md\nsessionManager.ts'));
    const { graphifyQuery } = await import('./graphify.js');

    const out = await graphifyQuery({ query: 'auth flow', repoRoot: '/r' });
    expect(out).toContain('auth-flow.md');
    const args = runCommand.mock.calls[0]?.[1];
    expect(args).toEqual(['query', 'auth flow', '--graph', '/r/graphify-out/graph.json']);
  });

  it('analyzeRepo shells out with analyze + path', async () => {
    runCommand.mockResolvedValueOnce(ok());
    const { analyzeRepo } = await import('./graphify.js');
    await analyzeRepo('/r');
    expect(runCommand.mock.calls[0]?.[1]).toEqual(['analyze', '/r']);
  });
});
