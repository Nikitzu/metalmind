import { existsSync } from 'node:fs';
import { mkdir, readFile, unlink, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { runCommand } from '../util/exec.js';
import { getTemplatesDir } from '../util/paths.js';

export const SERVICE_NAME = 'metalmind-vault-indexer.service';
export const DEFAULT_SYSTEMD_USER_DIR = join(homedir(), '.config', 'systemd', 'user');

export interface InstallSystemdOptions {
  vaultPath: string;
  watcherBin: string;
  templatesDir?: string;
  systemdUserDir?: string;
  skipEnable?: boolean;
}

export interface InstallSystemdResult {
  servicePath: string;
  wroteService: boolean;
  enabled: boolean;
}

export interface UninstallSystemdOptions {
  systemdUserDir?: string;
  skipDisable?: boolean;
}

export interface UninstallSystemdResult {
  servicePath: string;
  removedService: boolean;
  disabled: boolean;
}

function renderService(template: string, vars: Record<string, string>): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_match, key) => {
    const value = vars[key];
    if (value === undefined) {
      throw new Error(`Unbound systemd variable: ${key}`);
    }
    return value;
  });
}

export async function installSystemdWatcher(
  opts: InstallSystemdOptions,
): Promise<InstallSystemdResult> {
  const templatesDir = opts.templatesDir ?? getTemplatesDir();
  const systemdUserDir = opts.systemdUserDir ?? DEFAULT_SYSTEMD_USER_DIR;
  const servicePath = join(systemdUserDir, SERVICE_NAME);

  await mkdir(systemdUserDir, { recursive: true });

  const templatePath = join(templatesDir, 'systemd', `${SERVICE_NAME}.template`);
  const template = await readFile(templatePath, 'utf8');
  const rendered = renderService(template, {
    VAULT_PATH: opts.vaultPath,
    WATCHER_BIN: opts.watcherBin,
    PATH_VALUE: process.env.PATH ?? '/usr/local/bin:/usr/bin:/bin',
  });

  const prior = existsSync(servicePath) ? await readFile(servicePath, 'utf8') : null;
  const wroteService = prior !== rendered;
  if (wroteService) {
    await writeFile(servicePath, rendered, 'utf8');
  }

  if (opts.skipEnable) {
    return { servicePath, wroteService, enabled: false };
  }

  const reload = await runCommand('systemctl', ['--user', 'daemon-reload']);
  if (!reload.ok) {
    throw new Error(`systemctl --user daemon-reload failed: ${reload.stderr || reload.stdout}`);
  }

  const enable = await runCommand('systemctl', ['--user', 'enable', '--now', SERVICE_NAME]);
  if (!enable.ok) {
    throw new Error(`systemctl --user enable failed: ${enable.stderr || enable.stdout}`);
  }

  // If we just rewrote the unit file, restart so the new config takes effect.
  if (wroteService && prior !== null) {
    await runCommand('systemctl', ['--user', 'restart', SERVICE_NAME]);
  }

  return { servicePath, wroteService, enabled: true };
}

export async function uninstallSystemdWatcher(
  opts: UninstallSystemdOptions = {},
): Promise<UninstallSystemdResult> {
  const systemdUserDir = opts.systemdUserDir ?? DEFAULT_SYSTEMD_USER_DIR;
  const servicePath = join(systemdUserDir, SERVICE_NAME);

  let disabled = false;
  if (!opts.skipDisable && existsSync(servicePath)) {
    const disable = await runCommand('systemctl', ['--user', 'disable', '--now', SERVICE_NAME]);
    disabled = disable.ok;
  }

  let removedService = false;
  if (existsSync(servicePath)) {
    await unlink(servicePath);
    removedService = true;
  }

  if (!opts.skipDisable && removedService) {
    await runCommand('systemctl', ['--user', 'daemon-reload']);
  }

  return { servicePath, removedService, disabled };
}
