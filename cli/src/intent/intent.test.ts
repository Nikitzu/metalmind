import { readFileSync } from 'node:fs';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CommandResult } from '../util/exec.js';

const runCommand = vi.hoisted(() =>
  vi.fn<(cmd: string, args?: string[], opts?: Record<string, unknown>) => Promise<CommandResult>>(),
);
vi.mock('../util/exec.js', () => ({ runCommand }));

const HERE = dirname(fileURLToPath(import.meta.url));
const FIXTURE = readFileSync(join(HERE, '__fixtures__', 'intent-list.json'), 'utf8');

function ok(stdout: string): CommandResult {
  return { stdout, stderr: '', ok: true, exitCode: 0 };
}

async function repoWithIntent(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'mm-intent-repo-'));
  await mkdir(join(dir, 'node_modules', '.bin'), { recursive: true });
  await writeFile(join(dir, 'node_modules', '.bin', 'intent'), '#!/bin/sh\n', { mode: 0o755 });
  return dir;
}

describe('listIntentSkills', () => {
  let repo: string;

  beforeEach(async () => {
    runCommand.mockReset();
    repo = await repoWithIntent();
  });
  afterEach(async () => {
    await rm(repo, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  it('parses the real fixture into packages with skill counts', async () => {
    runCommand.mockResolvedValue(ok(FIXTURE));
    const { listIntentSkills } = await import('./intent.js');

    const res = await listIntentSkills(repo);

    expect(res.status).toBe('ok');
    expect(res.packages.map((p) => p.name)).toContain('@tanstack/db');
    const db = res.packages.find((p) => p.name === '@tanstack/db');
    expect(db?.skillCount).toBe(7);
    expect(res.skillCount).toBeGreaterThan(0);
  });

  it('runs the repo-local binary with cwd set to the repo', async () => {
    runCommand.mockResolvedValue(ok(FIXTURE));
    const { listIntentSkills } = await import('./intent.js');
    await listIntentSkills(repo);

    const [cmd, args, opts] = runCommand.mock.calls[0] ?? [];
    expect(cmd).toBe(join(repo, 'node_modules', '.bin', 'intent'));
    expect(args).toEqual(['list', '--json']);
    expect(opts).toMatchObject({ cwd: repo });
  });

  it('reports unavailable without spawning anything when the binary is absent', async () => {
    const bare = await mkdtemp(join(tmpdir(), 'mm-intent-bare-'));
    const { listIntentSkills } = await import('./intent.js');

    const res = await listIntentSkills(bare);

    expect(res.status).toBe('unavailable');
    expect(runCommand).not.toHaveBeenCalled();
    await rm(bare, { recursive: true, force: true });
  });

  it('treats a non-zero exit as unavailable', async () => {
    runCommand.mockResolvedValue({ stdout: '', stderr: 'boom', ok: false, exitCode: 1 });
    const { listIntentSkills } = await import('./intent.js');
    expect((await listIntentSkills(repo)).status).toBe('unavailable');
  });

  it('treats unparseable output as unavailable', async () => {
    runCommand.mockResolvedValue(ok('not json at all'));
    const { listIntentSkills } = await import('./intent.js');
    expect((await listIntentSkills(repo)).status).toBe('unavailable');
  });

  it('reports an empty dependency graph as ok with nothing found', async () => {
    runCommand.mockResolvedValue(ok(JSON.stringify({ skills: [], packages: [] })));
    const { listIntentSkills } = await import('./intent.js');

    const res = await listIntentSkills(repo);

    expect(res.status).toBe('ok');
    expect(res.packages).toEqual([]);
    expect(res.skillCount).toBe(0);
  });
});

describe('scanForgeIntentSkills', () => {
  beforeEach(() => runCommand.mockReset());

  it('returns an empty scan and spawns nothing when no forge groups exist', async () => {
    const { scanForgeIntentSkills } = await import('./intent.js');
    const res = await scanForgeIntentSkills({});
    expect(res.repos).toEqual([]);
    expect(runCommand).not.toHaveBeenCalled();
  });

  it('skips repo paths that do not exist', async () => {
    const { scanForgeIntentSkills } = await import('./intent.js');
    const res = await scanForgeIntentSkills({ g: { repos: ['/definitely/not/here'] } });
    expect(res.repos).toEqual([]);
    expect(runCommand).not.toHaveBeenCalled();
  });

  it('scans each repo once even when several groups list it', async () => {
    const repo = await repoWithIntent();
    runCommand.mockResolvedValue(ok(FIXTURE));
    const { scanForgeIntentSkills } = await import('./intent.js');

    const res = await scanForgeIntentSkills({ a: { repos: [repo] }, b: { repos: [repo] } });

    expect(res.repos).toHaveLength(1);
    expect(runCommand).toHaveBeenCalledTimes(1);
    await rm(repo, { recursive: true, force: true });
  });

  it('stops scanning once the shared budget is exhausted', async () => {
    const repo = await repoWithIntent();
    runCommand.mockResolvedValue(ok(FIXTURE));
    const { scanForgeIntentSkills } = await import('./intent.js');

    const res = await scanForgeIntentSkills({ g: { repos: [repo] } }, { deadline: Date.now() - 1 });

    expect(res.repos).toEqual([]);
    expect(runCommand).not.toHaveBeenCalled();
    await rm(repo, { recursive: true, force: true });
  });
});
