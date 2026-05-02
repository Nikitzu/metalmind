import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { runCommand } from '../util/exec.js';
import { expandTilde, getTemplatesDir } from '../util/paths.js';
import { type SentinelUpsertAction, upsertSentinelBlock } from '../util/sentinel.js';

export const VAULT_GITIGNORE_MARKERS = {
  begin: '# metalmind:managed:begin',
  end: '# metalmind:managed:end',
} as const;

export type VaultGitAction = 'initialized' | 'already-tracked' | 'skipped';

export interface SetupVaultGitOptions {
  vaultPath: string;
  enable: boolean;
  templatesDir?: string;
}

export interface SetupVaultGitResult {
  action: VaultGitAction;
  gitignoreAction: SentinelUpsertAction | 'skipped';
  initialCommit: boolean;
  commitWarning?: string;
}

async function isGitInstalled(): Promise<boolean> {
  const res = await runCommand('git', ['--version']);
  return res.ok;
}

async function hasAnyCommit(cwd: string): Promise<boolean> {
  const res = await runCommand('git', ['-C', cwd, 'rev-parse', '--verify', 'HEAD']);
  return res.ok;
}

async function workingTreeHasChanges(cwd: string): Promise<boolean> {
  const res = await runCommand('git', ['-C', cwd, 'status', '--porcelain']);
  return res.ok && res.stdout.trim().length > 0;
}

export async function setupVaultGit(opts: SetupVaultGitOptions): Promise<SetupVaultGitResult> {
  if (!opts.enable) {
    return { action: 'skipped', gitignoreAction: 'skipped', initialCommit: false };
  }

  const vaultPath = expandTilde(opts.vaultPath);
  if (!existsSync(vaultPath)) {
    throw new Error(`vault path does not exist: ${vaultPath}`);
  }

  if (!(await isGitInstalled())) {
    throw new Error('git not found on PATH — install git or re-run with no git tracking');
  }

  const dotGit = join(vaultPath, '.git');
  const alreadyTracked = existsSync(dotGit);

  if (!alreadyTracked) {
    const init = await runCommand('git', ['-C', vaultPath, 'init', '--initial-branch=main']);
    if (!init.ok) {
      // Older git (< 2.28) doesn't support --initial-branch. Retry without it.
      const fallback = await runCommand('git', ['-C', vaultPath, 'init']);
      if (!fallback.ok) {
        throw new Error(`git init failed: ${fallback.stderr || init.stderr}`);
      }
    }
  }

  const templatesDir = opts.templatesDir ?? getTemplatesDir();
  const blockSource = await readFile(
    join(templatesDir, 'vault', '.gitignore.block.template'),
    'utf8',
  );
  const { action: gitignoreAction } = await upsertSentinelBlock({
    path: join(vaultPath, '.gitignore'),
    content: blockSource,
    markers: VAULT_GITIGNORE_MARKERS,
  });

  let initialCommit = false;
  let commitWarning: string | undefined;
  if (!alreadyTracked && !(await hasAnyCommit(vaultPath)) && (await workingTreeHasChanges(vaultPath))) {
    const add = await runCommand('git', ['-C', vaultPath, 'add', '-A']);
    if (!add.ok) {
      commitWarning = `git add failed: ${add.stderr || 'unknown error'}`;
    } else {
      const commit = await runCommand('git', [
        '-C',
        vaultPath,
        'commit',
        '-m',
        'metalmind: initial vault snapshot',
      ]);
      if (commit.ok) {
        initialCommit = true;
      } else {
        commitWarning =
          commit.stderr.trim() ||
          'commit failed — check that user.name and user.email are configured (git config --global ...)';
      }
    }
  }

  return {
    action: alreadyTracked ? 'already-tracked' : 'initialized',
    gitignoreAction,
    initialCommit,
    ...(commitWarning ? { commitWarning } : {}),
  };
}
