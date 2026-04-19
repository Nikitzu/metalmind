import { existsSync } from 'node:fs';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';

export const DEFAULT_SETTINGS_PATH = join(homedir(), '.claude', 'settings.json');
export const DISABLE_AUTO_MEMORY_KEY = 'CLAUDE_CODE_DISABLE_AUTO_MEMORY';

export interface ClaudeSettings {
  env?: Record<string, string>;
  [key: string]: unknown;
}

export interface MemoryRoutingOptions {
  settingsPath?: string;
  disableNative: boolean;
}

export interface MemoryRoutingResult {
  settingsPath: string;
  changed: boolean;
  priorValue: string | undefined;
}

async function readSettings(path: string): Promise<ClaudeSettings> {
  if (!existsSync(path)) return {};
  const raw = await readFile(path, 'utf8');
  if (!raw.trim()) return {};
  return JSON.parse(raw) as ClaudeSettings;
}

async function writeSettings(path: string, data: ClaudeSettings): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const tmp = `${path}.tmp`;
  await writeFile(tmp, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
  await rename(tmp, path);
}

export async function applyMemoryRouting(
  opts: MemoryRoutingOptions,
): Promise<MemoryRoutingResult> {
  const settingsPath = opts.settingsPath ?? DEFAULT_SETTINGS_PATH;
  const data = await readSettings(settingsPath);
  const env = data.env ?? {};
  const priorValue = env[DISABLE_AUTO_MEMORY_KEY];

  let changed = false;
  if (opts.disableNative) {
    if (priorValue !== '1') {
      env[DISABLE_AUTO_MEMORY_KEY] = '1';
      data.env = env;
      changed = true;
    }
  } else if (priorValue !== undefined) {
    delete env[DISABLE_AUTO_MEMORY_KEY];
    if (Object.keys(env).length === 0) delete data.env;
    else data.env = env;
    changed = true;
  }

  if (changed) await writeSettings(settingsPath, data);
  return { settingsPath, changed, priorValue };
}

export async function clearMemoryRouting(settingsPath?: string): Promise<boolean> {
  const path = settingsPath ?? DEFAULT_SETTINGS_PATH;
  if (!existsSync(path)) return false;
  const data = await readSettings(path);
  if (!data.env || !(DISABLE_AUTO_MEMORY_KEY in data.env)) return false;
  delete data.env[DISABLE_AUTO_MEMORY_KEY];
  if (Object.keys(data.env).length === 0) delete data.env;
  await writeSettings(path, data);
  return true;
}
