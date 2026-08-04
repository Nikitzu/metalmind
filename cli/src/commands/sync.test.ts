import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { runCommand } from '../util/exec.js';
import { syncVault } from './sync.js';

async function git(cwd: string, ...args: string[]): Promise<string> {
  const res = await runCommand('git', ['-C', cwd, ...args]);
  if (!res.ok) throw new Error(`git ${args.join(' ')} failed: ${res.stderr}`);
  return res.stdout;
}

describe('syncVault', () => {
  let tmp: string;
  let vaultPath: string;
  let remotePath: string;
  const savedEnv: Record<string, string | undefined> = {};

  beforeAll(() => {
    for (const key of [
      'GIT_AUTHOR_NAME',
      'GIT_AUTHOR_EMAIL',
      'GIT_COMMITTER_NAME',
      'GIT_COMMITTER_EMAIL',
    ]) {
      savedEnv[key] = process.env[key];
    }
    process.env.GIT_AUTHOR_NAME = 'metalmind-test';
    process.env.GIT_AUTHOR_EMAIL = 'test@metalmind.local';
    process.env.GIT_COMMITTER_NAME = 'metalmind-test';
    process.env.GIT_COMMITTER_EMAIL = 'test@metalmind.local';
  });

  afterAll(() => {
    for (const [key, value] of Object.entries(savedEnv)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });

  beforeEach(async () => {
    tmp = await mkdtemp(join(tmpdir(), 'metalmind-sync-'));
    remotePath = join(tmp, 'remote.git');
    vaultPath = join(tmp, 'vault');
    await mkdir(remotePath, { recursive: true });
    await runCommand('git', ['init', '--bare', '--initial-branch=main', remotePath]);
    await mkdir(join(vaultPath, 'Plans'), { recursive: true });
    await runCommand('git', ['init', '--initial-branch=main', vaultPath]);
    await writeFile(join(vaultPath, 'Plans', 'x.md'), 'plan body\n', 'utf8');
    await writeFile(join(vaultPath, 'Plans', 'keep.md'), 'kept\n', 'utf8');
    await git(vaultPath, 'add', '-A');
    await git(vaultPath, 'commit', '-m', 'seed');
    await git(vaultPath, 'remote', 'add', 'origin', remotePath);
    await git(vaultPath, 'push', '-u', 'origin', 'main');
  });

  afterEach(async () => {
    await rm(tmp, { recursive: true, force: true });
  });

  it('reports clean when there is nothing to sync', async () => {
    const result = await syncVault({ vaultPath, message: 'noop' });
    expect(result.outcome).toBe('clean');
    expect(result.committed).toBe(false);
  });

  it('commits and pushes a new note', async () => {
    await writeFile(join(vaultPath, 'Plans', 'y.md'), 'new note\n', 'utf8');
    const result = await syncVault({ vaultPath, message: 'add y' });
    expect(result.outcome).toBe('synced');
    expect(result.committed).toBe(true);
    expect(result.pushed).toBe(true);
    expect(await git(remotePath, 'log', '--format=%s', '-1')).toBe('add y');
  });

  it('allows an archive move because the content survives', async () => {
    await mkdir(join(vaultPath, 'Archive', 'Plans'), { recursive: true });
    await writeFile(join(vaultPath, 'Archive', 'Plans', 'x.md'), 'plan body\n', 'utf8');
    await rm(join(vaultPath, 'Plans', 'x.md'));
    const result = await syncVault({ vaultPath, message: 'archive x' });
    expect(result.outcome).toBe('synced');
  });

  it('refuses a deletion whose content does not survive', async () => {
    await rm(join(vaultPath, 'Plans', 'x.md'));
    await writeFile(join(vaultPath, 'Plans', 'z.md'), 'different content\n', 'utf8');
    const result = await syncVault({ vaultPath, message: 'drop x' });
    expect(result.outcome).toBe('blocked');
    expect(result.committed).toBe(false);
    expect(result.report?.violations.map((v) => v.guard)).toContain('unexplained-deletion');
    expect(await git(vaultPath, 'log', '--format=%s', '-1')).toBe('seed');
    expect(await git(vaultPath, 'diff', '--cached', '--name-only')).toBe('');
  });

  it('commits a blocked change set when force is set', async () => {
    await rm(join(vaultPath, 'Plans', 'x.md'));
    const result = await syncVault({ vaultPath, message: 'drop x', force: true });
    expect(result.outcome).toBe('synced');
    expect(result.forcedPastGuards).toBe(true);
  });

  it('leaves the index untouched on dry run', async () => {
    await writeFile(join(vaultPath, 'Plans', 'y.md'), 'new note\n', 'utf8');
    const result = await syncVault({ vaultPath, message: 'add y', dryRun: true });
    expect(result.outcome).toBe('dry-run');
    expect(result.committed).toBe(false);
    expect(await git(vaultPath, 'status', '--porcelain')).toContain('?? Plans/y.md');
  });

  it('refuses to run when a rebase is half-finished', async () => {
    await mkdir(join(vaultPath, '.git', 'rebase-merge'), { recursive: true });
    const result = await syncVault({ vaultPath, message: 'anything' });
    expect(result.outcome).toBe('needs-manual-resolution');
  });

  it('skips the push when noPush is set but still commits', async () => {
    await writeFile(join(vaultPath, 'Plans', 'y.md'), 'new note\n', 'utf8');
    const result = await syncVault({ vaultPath, message: 'add y', noPush: true });
    expect(result.committed).toBe(true);
    expect(result.pushed).toBe(false);
    expect(await git(remotePath, 'log', '--format=%s', '-1')).toBe('seed');
  });

  it('generates a commit message from the change counts when none is given', async () => {
    await writeFile(join(vaultPath, 'Plans', 'y.md'), 'new note\n', 'utf8');
    await writeFile(join(vaultPath, 'Plans', 'keep.md'), 'kept, edited\n', 'utf8');
    const result = await syncVault({ vaultPath });
    expect(result.outcome).toBe('synced');
    expect(await git(vaultPath, 'log', '--format=%s', '-1')).toBe('Sync vault: 1 added, 1 updated');
  });

  it('reports not-configured when the path is not a git repository', async () => {
    const bare = join(tmp, 'not-a-repo');
    await mkdir(bare, { recursive: true });
    const result = await syncVault({ vaultPath: bare });
    expect(result.outcome).toBe('not-configured');
  });
});
