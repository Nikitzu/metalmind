import { existsSync } from 'node:fs';
import { mkdir, readFile, unlink, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { runCommand } from '../util/exec.js';
import { getTemplatesDir } from '../util/paths.js';

export const PLIST_NAME = 'com.metalmind.vault-indexer.plist';
export const DEFAULT_LAUNCH_AGENTS_DIR = join(homedir(), 'Library', 'LaunchAgents');

export interface InstallWatcherOptions {
  vaultPath: string;
  watcherBin: string;
  uvBin: string;
  templatesDir?: string;
  launchAgentsDir?: string;
  skipLoad?: boolean;
}

export interface InstallWatcherResult {
  plistPath: string;
  wrotePlist: boolean;
  loaded: boolean;
}

export interface UninstallWatcherOptions {
  launchAgentsDir?: string;
  skipUnload?: boolean;
}

export interface UninstallWatcherResult {
  plistPath: string;
  removedPlist: boolean;
  unloaded: boolean;
}

function renderPlist(template: string, vars: Record<string, string>): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_match, key) => {
    const value = vars[key];
    if (value === undefined) {
      throw new Error(`Unbound plist variable: ${key}`);
    }
    return value;
  });
}

export async function installLaunchdWatcher(
  opts: InstallWatcherOptions,
): Promise<InstallWatcherResult> {
  const templatesDir = opts.templatesDir ?? getTemplatesDir();
  const launchAgentsDir = opts.launchAgentsDir ?? DEFAULT_LAUNCH_AGENTS_DIR;
  const plistPath = join(launchAgentsDir, PLIST_NAME);

  await mkdir(launchAgentsDir, { recursive: true });

  const templatePath = join(templatesDir, 'launchd', `${PLIST_NAME}.template`);
  const template = await readFile(templatePath, 'utf8');
  const rendered = renderPlist(template, {
    VAULT_PATH: opts.vaultPath,
    WATCHER_BIN: opts.watcherBin,
    UV_BIN: opts.uvBin,
    PATH_VALUE: process.env.PATH ?? '/usr/local/bin:/usr/bin:/bin',
  });

  const prior = existsSync(plistPath) ? await readFile(plistPath, 'utf8') : null;
  const wrotePlist = prior !== rendered;
  if (wrotePlist) {
    if (prior !== null) {
      await runCommand('launchctl', ['unload', plistPath]);
    }
    await writeFile(plistPath, rendered, 'utf8');
  }

  if (opts.skipLoad) {
    return { plistPath, wrotePlist, loaded: false };
  }

  const load = await runCommand('launchctl', ['load', plistPath]);
  if (load.ok) {
    return { plistPath, wrotePlist, loaded: true };
  }

  const uid = process.getuid?.() ?? 0;
  const bootstrap = await runCommand('launchctl', ['bootstrap', `gui/${uid}`, plistPath]);
  if (!bootstrap.ok) {
    throw new Error(
      `launchctl load/bootstrap failed: ${load.stderr || bootstrap.stderr || 'unknown error'}`,
    );
  }
  return { plistPath, wrotePlist, loaded: true };
}

export async function uninstallLaunchdWatcher(
  opts: UninstallWatcherOptions = {},
): Promise<UninstallWatcherResult> {
  const launchAgentsDir = opts.launchAgentsDir ?? DEFAULT_LAUNCH_AGENTS_DIR;
  const plistPath = join(launchAgentsDir, PLIST_NAME);

  let unloaded = false;
  if (!opts.skipUnload && existsSync(plistPath)) {
    const unload = await runCommand('launchctl', ['unload', plistPath]);
    if (unload.ok) {
      unloaded = true;
    } else {
      const uid = process.getuid?.() ?? 0;
      const bootout = await runCommand('launchctl', ['bootout', `gui/${uid}`, plistPath]);
      unloaded = bootout.ok;
    }
  }

  let removedPlist = false;
  if (existsSync(plistPath)) {
    await unlink(plistPath);
    removedPlist = true;
  }

  return { plistPath, removedPlist, unloaded };
}
