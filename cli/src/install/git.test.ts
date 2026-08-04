import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { runCommand } from '../util/exec.js';
import { setupVaultGit, VAULT_GITIGNORE_MARKERS } from './git.js';

describe('setupVaultGit', () => {
  let tmp: string;
  let templatesDir: string;
  let vaultPath: string;
  const savedEnv: Record<string, string | undefined> = {};

  beforeAll(() => {
    // Ensure git commits succeed regardless of host config - we only override
    // identity for this test process; nothing leaks beyond it.
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
    tmp = await mkdtemp(join(tmpdir(), 'metalmind-git-'));
    templatesDir = join(tmp, 'templates');
    await mkdir(join(templatesDir, 'vault'), { recursive: true });
    await writeFile(
      join(templatesDir, 'vault', '.gitignore.block.template'),
      '.obsidian/workspace\n.trash/\n',
      'utf8',
    );
    vaultPath = join(tmp, 'vault');
    await mkdir(vaultPath, { recursive: true });
    await writeFile(join(vaultPath, 'CLAUDE.md'), '# vault\n', 'utf8');
  });

  afterEach(async () => {
    await rm(tmp, { recursive: true, force: true });
  });

  it('returns skipped when enable=false and does not touch the vault', async () => {
    const result = await setupVaultGit({ vaultPath, enable: false, templatesDir });
    expect(result.action).toBe('skipped');
    expect(result.gitignoreAction).toBe('skipped');
    expect(result.initialCommit).toBe(false);
    expect(existsSync(join(vaultPath, '.git'))).toBe(false);
    expect(existsSync(join(vaultPath, '.gitignore'))).toBe(false);
  });

  it('initializes a fresh repo, writes managed .gitignore block, and commits', async () => {
    const result = await setupVaultGit({ vaultPath, enable: true, templatesDir });

    expect(result.action).toBe('initialized');
    expect(result.gitignoreAction).toBe('created');
    expect(result.initialCommit).toBe(true);
    expect(result.commitWarning).toBeUndefined();
    expect(existsSync(join(vaultPath, '.git'))).toBe(true);

    const gitignore = await readFile(join(vaultPath, '.gitignore'), 'utf8');
    expect(gitignore).toContain(VAULT_GITIGNORE_MARKERS.begin);
    expect(gitignore).toContain(VAULT_GITIGNORE_MARKERS.end);
    expect(gitignore).toContain('.obsidian/workspace');

    const log = await runCommand('git', ['-C', vaultPath, 'log', '--oneline']);
    expect(log.ok).toBe(true);
    expect(log.stdout).toContain('metalmind: initial vault snapshot');
  });

  it('is idempotent: second run does not re-init and reports unchanged gitignore', async () => {
    const first = await setupVaultGit({ vaultPath, enable: true, templatesDir });
    expect(first.action).toBe('initialized');

    const second = await setupVaultGit({ vaultPath, enable: true, templatesDir });
    expect(second.action).toBe('already-tracked');
    expect(second.gitignoreAction).toBe('unchanged');
    expect(second.initialCommit).toBe(false);
  });

  it('preserves user .gitignore content outside the managed block', async () => {
    await writeFile(join(vaultPath, '.gitignore'), 'my-secret-folder/\n*.private\n', 'utf8');
    await runCommand('git', ['-C', vaultPath, 'init']);

    const result = await setupVaultGit({ vaultPath, enable: true, templatesDir });
    expect(result.action).toBe('already-tracked');
    expect(result.gitignoreAction).toBe('inserted');

    const contents = await readFile(join(vaultPath, '.gitignore'), 'utf8');
    expect(contents).toContain('my-secret-folder/');
    expect(contents).toContain('*.private');
    expect(contents).toContain(VAULT_GITIGNORE_MARKERS.begin);
    expect(contents).toContain('.obsidian/workspace');
  });

  it('refreshes a stale managed block on re-run with new template', async () => {
    await setupVaultGit({ vaultPath, enable: true, templatesDir });

    await writeFile(
      join(templatesDir, 'vault', '.gitignore.block.template'),
      '.obsidian/workspace\n.trash/\nnew-pattern/\n',
      'utf8',
    );
    const second = await setupVaultGit({ vaultPath, enable: true, templatesDir });
    expect(second.gitignoreAction).toBe('updated');

    const contents = await readFile(join(vaultPath, '.gitignore'), 'utf8');
    expect(contents).toContain('new-pattern/');
  });

  it('throws when vault path does not exist', async () => {
    await expect(
      setupVaultGit({ vaultPath: join(tmp, 'no-such-vault'), enable: true, templatesDir }),
    ).rejects.toThrow(/vault path does not exist/);
  });
});
