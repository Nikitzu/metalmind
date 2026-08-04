import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { log } from '@clack/prompts';
import { readConfig } from '../config.js';
import { runCommand } from '../util/exec.js';
import { expandTilde } from '../util/paths.js';
import {
  analyzeStagedChanges,
  findUnstagedEntries,
  type GuardReport,
  parseRawDiffZ,
} from '../vault/sync-guards.js';

export type SyncOutcome =
  | 'clean'
  | 'synced'
  | 'blocked'
  | 'dry-run'
  | 'needs-manual-resolution'
  | 'not-configured';

export interface SyncVaultOptions {
  vaultPath?: string;
  message?: string;
  dryRun?: boolean;
  noPush?: boolean;
  force?: boolean;
}

export interface SyncVaultResult {
  outcome: SyncOutcome;
  committed: boolean;
  pushed: boolean;
  forcedPastGuards: boolean;
  report: GuardReport | null;
  detail: string;
}

const GIT_TIMEOUT_MS = 120_000;

async function git(cwd: string, args: string[]) {
  return runCommand('git', ['-C', cwd, ...args], { timeoutMs: GIT_TIMEOUT_MS });
}

function result(partial: Partial<SyncVaultResult> & { outcome: SyncOutcome }): SyncVaultResult {
  return {
    committed: false,
    pushed: false,
    forcedPastGuards: false,
    report: null,
    detail: '',
    ...partial,
  };
}

function inProgressOperation(vaultPath: string): string | null {
  if (existsSync(join(vaultPath, '.git', 'rebase-merge'))) return 'rebase';
  if (existsSync(join(vaultPath, '.git', 'rebase-apply'))) return 'rebase';
  if (existsSync(join(vaultPath, '.git', 'MERGE_HEAD'))) return 'merge';
  return null;
}

async function resolveVaultPath(override?: string): Promise<string | null> {
  if (override) return expandTilde(override);
  const cfg = await readConfig();
  return cfg ? expandTilde(cfg.vaultPath) : null;
}

export async function syncVault(opts: SyncVaultOptions = {}): Promise<SyncVaultResult> {
  const vaultPath = await resolveVaultPath(opts.vaultPath);
  if (!vaultPath) {
    return result({
      outcome: 'not-configured',
      detail: 'metalmind not initialized - run `metalmind init` first',
    });
  }

  if (!existsSync(join(vaultPath, '.git'))) {
    return result({
      outcome: 'not-configured',
      detail: `${vaultPath} is not a git repository. Run \`metalmind init\` with git tracking enabled.`,
    });
  }

  const stuck = inProgressOperation(vaultPath);
  if (stuck) {
    return result({
      outcome: 'needs-manual-resolution',
      detail: `A ${stuck} is half-finished in the vault. Resolve it by hand before syncing, and never auto-resolve a conflict in notes.`,
    });
  }

  const hasRemote = (await git(vaultPath, ['remote', 'get-url', 'origin'])).ok;

  if (hasRemote && !opts.dryRun) {
    const pull = await git(vaultPath, ['pull', '--rebase', '--autostash']);
    if (!pull.ok) {
      await git(vaultPath, ['rebase', '--abort']);
      return result({
        outcome: 'needs-manual-resolution',
        detail: `Pull failed and the rebase was aborted, leaving the vault as it was. Resolve by hand:\n${pull.stderr}`,
      });
    }
  }

  const staged = await git(vaultPath, ['add', '-A']);
  if (!staged.ok) {
    return result({
      outcome: 'needs-manual-resolution',
      detail: `git add failed: ${staged.stderr}`,
    });
  }

  const porcelain = await git(vaultPath, ['status', '--porcelain']);
  const leftUnstaged = findUnstagedEntries(porcelain.stdout);

  const rawDiff = await git(vaultPath, ['diff', '--cached', '--raw', '-M', '-z']);
  const changes = parseRawDiffZ(rawDiff.stdout);
  const report = analyzeStagedChanges(changes);

  if (leftUnstaged.length > 0) {
    report.violations.push({
      guard: 'incomplete-staging',
      message:
        'Entries remained unstaged after `git add -A`; the index disagrees with the filesystem.',
      paths: leftUnstaged,
    });
    report.safe = false;
  }

  if (changes.length === 0) {
    if (opts.dryRun) return result({ outcome: 'dry-run', report, detail: 'Nothing staged.' });
    const ahead = await git(vaultPath, ['rev-list', '--count', '@{u}..HEAD']);
    if (hasRemote && !opts.noPush && Number(ahead.stdout.trim() || '0') > 0) {
      return { ...(await pushAndVerify(vaultPath)), report };
    }
    return result({ outcome: 'clean', report, detail: 'Vault already in sync.' });
  }

  if (opts.dryRun) {
    await git(vaultPath, ['reset', '--quiet']);
    return result({ outcome: 'dry-run', report, detail: describeReport(report) });
  }

  if (!report.safe && !opts.force) {
    await git(vaultPath, ['reset', '--quiet']);
    return result({ outcome: 'blocked', report, detail: describeReport(report) });
  }

  const message = opts.message?.trim() || defaultMessage(report);
  const commit = await git(vaultPath, ['commit', '-m', message]);
  if (!commit.ok) {
    return result({
      outcome: 'needs-manual-resolution',
      report,
      detail: `Commit failed: ${commit.stderr}`,
    });
  }

  if (!hasRemote || opts.noPush) {
    return result({
      outcome: 'synced',
      committed: true,
      forcedPastGuards: !report.safe,
      report,
      detail: hasRemote ? 'Committed; push skipped.' : 'Committed; no remote configured.',
    });
  }

  const pushed = await pushAndVerify(vaultPath);
  return { ...pushed, committed: true, forcedPastGuards: !report.safe, report };
}

async function pushAndVerify(vaultPath: string): Promise<SyncVaultResult> {
  const push = await git(vaultPath, ['push', 'origin', 'HEAD']);
  if (!push.ok) {
    return result({
      outcome: 'needs-manual-resolution',
      detail: `Push rejected, the remote moved. Re-run sync to rebase, or resolve by hand:\n${push.stderr}`,
    });
  }
  const remaining = await git(vaultPath, ['rev-list', '--count', '@{u}..HEAD']);
  const outstanding = Number(remaining.stdout.trim() || '0');
  if (outstanding > 0) {
    return result({
      outcome: 'needs-manual-resolution',
      detail: `Push reported success but ${outstanding} commit(s) are still ahead of the remote.`,
    });
  }
  return result({ outcome: 'synced', pushed: true, detail: 'Pushed and verified.' });
}

function defaultMessage(report: GuardReport): string {
  const { added, modified, deleted, renamed } = report.counts;
  const parts: string[] = [];
  if (added > 0) parts.push(`${added} added`);
  if (modified > 0) parts.push(`${modified} updated`);
  if (renamed > 0) parts.push(`${renamed} moved`);
  if (deleted > 0) parts.push(`${deleted} removed`);
  return `Sync vault: ${parts.join(', ') || 'no changes'}`;
}

function describeCounts(report: GuardReport): string {
  const { added, modified, deleted, renamed } = report.counts;
  return `${added} added, ${modified} modified, ${renamed} renamed, ${deleted} deleted`;
}

function describeReport(report: GuardReport): string {
  if (report.violations.length === 0) return describeCounts(report);
  return report.violations
    .map((v) => `${v.guard}: ${v.message}\n  ${v.paths.slice(0, 20).join('\n  ')}`)
    .join('\n\n');
}

export interface SyncCmdOptions {
  message?: string;
  dryRun?: boolean;
  push?: boolean;
  force?: boolean;
  vault?: string;
}

export async function syncCmd(opts: SyncCmdOptions): Promise<void> {
  const res = await syncVault({
    vaultPath: opts.vault,
    message: opts.message,
    dryRun: opts.dryRun,
    noPush: opts.push === false,
    force: opts.force,
  });

  switch (res.outcome) {
    case 'synced':
      log.success(res.detail);
      if (res.forcedPastGuards) log.warn('Guards were overridden with --force.');
      break;
    case 'clean':
      log.info(res.detail);
      break;
    case 'dry-run':
      log.step(res.detail);
      break;
    case 'blocked':
      log.error(`Refusing to commit. The staged change set looks like note loss.\n\n${res.detail}`);
      log.info(
        'Inspect with `git -C <vault> diff --cached --stat`. Override with --force once verified.',
      );
      process.exitCode = 1;
      break;
    case 'needs-manual-resolution':
    case 'not-configured':
      log.error(res.detail);
      process.exitCode = 2;
      break;
  }
}
