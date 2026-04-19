import { platform } from 'node:os';
import { installLaunchdWatcher, uninstallLaunchdWatcher } from './launchd.js';
import { installSystemdWatcher, uninstallSystemdWatcher } from './systemd.js';

export type WatcherPlatform = 'darwin' | 'linux';

export interface InstallWatcherOptions {
  vaultPath: string;
  watcherBin: string;
  uvBin: string;
  platformOverride?: WatcherPlatform;
  launchAgentsDir?: string;
  systemdUserDir?: string;
  templatesDir?: string;
  skipStart?: boolean;
}

export interface InstallWatcherResult {
  platform: WatcherPlatform;
  unitPath: string;
  wroteUnit: boolean;
  started: boolean;
}

export interface UninstallWatcherOptions {
  platformOverride?: WatcherPlatform;
  launchAgentsDir?: string;
  systemdUserDir?: string;
}

export interface UninstallWatcherResult {
  platform: WatcherPlatform;
  unitPath: string;
  removedUnit: boolean;
  stopped: boolean;
}

function detectPlatform(override?: WatcherPlatform): WatcherPlatform {
  if (override) return override;
  const p = platform();
  if (p === 'darwin') return 'darwin';
  if (p === 'linux') return 'linux';
  throw new Error(`metalmind watcher: unsupported platform "${p}" (need darwin or linux)`);
}

export async function installWatcher(
  opts: InstallWatcherOptions,
): Promise<InstallWatcherResult> {
  const target = detectPlatform(opts.platformOverride);

  if (target === 'darwin') {
    const r = await installLaunchdWatcher({
      vaultPath: opts.vaultPath,
      watcherBin: opts.watcherBin,
      uvBin: opts.uvBin,
      templatesDir: opts.templatesDir,
      launchAgentsDir: opts.launchAgentsDir,
      skipLoad: opts.skipStart,
    });
    return { platform: 'darwin', unitPath: r.plistPath, wroteUnit: r.wrotePlist, started: r.loaded };
  }

  const r = await installSystemdWatcher({
    vaultPath: opts.vaultPath,
    watcherBin: opts.watcherBin,
    uvBin: opts.uvBin,
    templatesDir: opts.templatesDir,
    systemdUserDir: opts.systemdUserDir,
    skipEnable: opts.skipStart,
  });
  return { platform: 'linux', unitPath: r.servicePath, wroteUnit: r.wroteService, started: r.enabled };
}

export async function uninstallWatcher(
  opts: UninstallWatcherOptions = {},
): Promise<UninstallWatcherResult> {
  const target = detectPlatform(opts.platformOverride);

  if (target === 'darwin') {
    const r = await uninstallLaunchdWatcher({ launchAgentsDir: opts.launchAgentsDir });
    return { platform: 'darwin', unitPath: r.plistPath, removedUnit: r.removedPlist, stopped: r.unloaded };
  }

  const r = await uninstallSystemdWatcher({ systemdUserDir: opts.systemdUserDir });
  return { platform: 'linux', unitPath: r.servicePath, removedUnit: r.removedService, stopped: r.disabled };
}
