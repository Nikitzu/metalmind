import { existsSync } from 'node:fs';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';

export const DEFAULT_SETTINGS_PATH = join(homedir(), '.claude', 'settings.json');
export const DISABLE_AUTO_MEMORY_KEY = 'CLAUDE_CODE_DISABLE_AUTO_MEMORY';
export const METALMIND_HOOK_MARKER = 'metalmind-session-start.sh';

export interface ClaudeHookEntry {
  type: 'command';
  command: string;
}

export interface ClaudeHookGroup {
  matcher?: string;
  hooks: ClaudeHookEntry[];
}

export interface ClaudeSettings {
  env?: Record<string, string>;
  hooks?: Record<string, ClaudeHookGroup[]>;
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

export interface SessionStartHookOptions {
  settingsPath?: string;
  hookCommand: string;
}

export interface SessionStartHookResult {
  settingsPath: string;
  changed: boolean;
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

export async function applyMemoryRouting(opts: MemoryRoutingOptions): Promise<MemoryRoutingResult> {
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

function isMetalmindHookGroup(group: ClaudeHookGroup): boolean {
  return group.hooks.some(
    (h) => typeof h?.command === 'string' && h.command.includes(METALMIND_HOOK_MARKER),
  );
}

export async function applyMetalmindSessionStartHook(
  opts: SessionStartHookOptions,
): Promise<SessionStartHookResult> {
  const settingsPath = opts.settingsPath ?? DEFAULT_SETTINGS_PATH;
  const data = await readSettings(settingsPath);
  const hooks = data.hooks ?? {};
  const sessionStart = hooks.SessionStart ?? [];

  const desired: ClaudeHookGroup = {
    matcher: '',
    hooks: [{ type: 'command', command: opts.hookCommand }],
  };

  const other = sessionStart.filter((g) => !isMetalmindHookGroup(g));
  const existing = sessionStart.find(isMetalmindHookGroup);
  const alreadyCorrect =
    existing !== undefined &&
    existing.hooks.length === 1 &&
    existing.hooks[0]?.command === opts.hookCommand;

  if (alreadyCorrect && other.length === sessionStart.length - 1) {
    return { settingsPath, changed: false };
  }

  hooks.SessionStart = [...other, desired];
  data.hooks = hooks;
  await writeSettings(settingsPath, data);
  return { settingsPath, changed: true };
}

export async function clearMetalmindSessionStartHook(settingsPath?: string): Promise<boolean> {
  const path = settingsPath ?? DEFAULT_SETTINGS_PATH;
  if (!existsSync(path)) return false;
  const data = await readSettings(path);
  const hooks = data.hooks;
  if (!hooks || !Array.isArray(hooks.SessionStart)) return false;

  const filtered = hooks.SessionStart.filter((g) => !isMetalmindHookGroup(g));
  if (filtered.length === hooks.SessionStart.length) return false;

  if (filtered.length === 0) delete hooks.SessionStart;
  else hooks.SessionStart = filtered;
  if (Object.keys(hooks).length === 0) delete data.hooks;
  else data.hooks = hooks;
  await writeSettings(path, data);
  return true;
}
