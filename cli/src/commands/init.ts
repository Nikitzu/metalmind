import { log } from '@clack/prompts';
import type { MetalmindHost } from '../config.js';
import { type RunWizardOptions, runWizard } from '../install/wizard.js';

export interface InitCliOptions {
  yes?: boolean;
  vaultPath?: string;
  flavor?: string;
  serena?: boolean;
  noSerena?: boolean;
  core?: boolean;
  full?: boolean;
  teams?: boolean;
  noTeams?: boolean;
  memoryRouting?: string;
  skipWatcher?: boolean;
  eodHook?: boolean;
  noEodHook?: boolean;
  notifications?: boolean;
  noNotifications?: boolean;
  git?: boolean;
  noGit?: boolean;
  autoInstallUv?: boolean;
  noAutoInstallUv?: boolean;
  /** "claude" | "codex" | "both" - bypass the host multi-select prompt. */
  host?: string;
  /** Opt-in MCP server registration in Codex. */
  withMcp?: boolean;
}

function isFlavor(v: string): v is 'scadrial' | 'classic' {
  return v === 'scadrial' || v === 'classic';
}

function isMemoryRouting(v: string): v is 'vault-only' | 'both' {
  return v === 'vault-only' || v === 'both';
}

function parseHostFlag(value: string | undefined): MetalmindHost[] | undefined {
  if (value === undefined) return undefined;
  switch (value) {
    case 'claude':
      return ['claude'];
    case 'codex':
      return ['codex'];
    case 'cursor':
      return ['cursor'];
    case 'both':
      return ['claude', 'codex'];
    case 'all':
      return ['claude', 'codex', 'cursor'];
    default:
      throw new Error(
        `--host must be "claude", "codex", "cursor", "both", or "all"; got "${value}"`,
      );
  }
}

function resolveBool(affirmative?: boolean, negative?: boolean): boolean | undefined {
  if (negative) return false;
  if (affirmative) return true;
  return undefined;
}

export async function init(cliOpts: InitCliOptions = {}): Promise<void> {
  try {
    const wizardOpts: RunWizardOptions = {};

    if (cliOpts.vaultPath) wizardOpts.vaultPath = cliOpts.vaultPath;
    if (cliOpts.flavor) {
      if (!isFlavor(cliOpts.flavor)) {
        throw new Error(`--flavor must be "scadrial" or "classic"; got "${cliOpts.flavor}"`);
      }
      wizardOpts.flavor = cliOpts.flavor;
    }
    if (cliOpts.memoryRouting) {
      if (!isMemoryRouting(cliOpts.memoryRouting)) {
        throw new Error(
          `--memory-routing must be "vault-only" or "both"; got "${cliOpts.memoryRouting}"`,
        );
      }
      wizardOpts.memoryRouting = cliOpts.memoryRouting;
    }

    const serena = resolveBool(cliOpts.serena, cliOpts.noSerena);
    if (serena !== undefined) wizardOpts.serena = serena;
    const teams = resolveBool(cliOpts.teams, cliOpts.noTeams);
    if (teams !== undefined) wizardOpts.enableTeams = teams;
    const eodHook = resolveBool(cliOpts.eodHook, cliOpts.noEodHook);
    if (eodHook !== undefined) wizardOpts.eodHook = eodHook;
    const notifications = resolveBool(cliOpts.notifications, cliOpts.noNotifications);
    if (notifications !== undefined) wizardOpts.notifications = notifications;
    const vaultGit = resolveBool(cliOpts.git, cliOpts.noGit);
    if (vaultGit !== undefined) wizardOpts.vaultGit = vaultGit;
    const autoInstallUv = resolveBool(cliOpts.autoInstallUv, cliOpts.noAutoInstallUv);
    if (autoInstallUv !== undefined) wizardOpts.autoInstallUv = autoInstallUv;

    const hostsFlag = parseHostFlag(cliOpts.host);
    if (hostsFlag !== undefined) wizardOpts.hosts = hostsFlag;
    if (cliOpts.withMcp) wizardOpts.withMcp = true;
    if (cliOpts.core && cliOpts.full) {
      throw new Error('--core and --full are mutually exclusive');
    }
    if (cliOpts.core) wizardOpts.core = true;
    if (cliOpts.full) wizardOpts.full = true;

    if (cliOpts.skipWatcher) wizardOpts.skipWatcher = true;

    // --yes fills in every remaining prompt with its default.
    if (cliOpts.yes) {
      if (wizardOpts.vaultPath === undefined) {
        wizardOpts.vaultPath = `${process.env.HOME}/Knowledge`;
      }
      if (wizardOpts.core === undefined) wizardOpts.full ??= true;
      wizardOpts.serena ??= true;
      wizardOpts.flavor ??= 'scadrial';
      wizardOpts.memoryRouting ??= 'vault-only';
      wizardOpts.enableTeams ??= true;
      wizardOpts.eodHook ??= true;
      wizardOpts.notifications ??= process.platform === 'darwin';
      wizardOpts.vaultGit ??= true;
      wizardOpts.autoInstallUv ??= true;
    }

    await runWizard(wizardOpts);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    log.error(`init failed: ${message}`);
    process.exitCode = 1;
  }
}
