// sessionStart hook for Cursor (~/.cursor/hooks.json).
//
// LATENT: Cursor 3.1.15 drops sessionStart additional_context before it reaches
// the agent (staff-confirmed bug, 2026-05-03). The hook is installed correct-
// per-schema and activates when Cursor ships the fix. Recall meanwhile is
// delivered by the metalmind-recall skill.
//
// Cursor hooks.json shape differs from Codex: top-level `version: 1`, lowercase
// `sessionStart` event, flat `{ command }` entries (no matcher/hooks nesting).

import { existsSync } from 'node:fs';
import { chmod, mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { getTemplatesDir } from '../../util/paths.js';
import { DEFAULT_CURSOR_DIR, recallCommand } from './shared.js';

export const METALMIND_CURSOR_HOOK_FILENAME = 'metalmind-cursor-session-start.sh';
const METALMIND_HOOK_MARKER = METALMIND_CURSOR_HOOK_FILENAME;

export interface CopyCursorHookOptions {
  templatesDir?: string;
  cursorDir?: string;
  flavor: 'scadrial' | 'classic';
}

export interface CopyCursorHookResult {
  hookScriptPath: string;
  hookCommand: string;
  action: 'created' | 'updated' | 'unchanged';
}

export async function copyCursorHook(opts: CopyCursorHookOptions): Promise<CopyCursorHookResult> {
  const templatesDir = opts.templatesDir ?? getTemplatesDir();
  const cursorDir = opts.cursorDir ?? DEFAULT_CURSOR_DIR;
  const hooksDir = join(cursorDir, 'hooks');
  await mkdir(hooksDir, { recursive: true });

  const hookScriptPath = join(hooksDir, METALMIND_CURSOR_HOOK_FILENAME);
  const srcPath = join(templatesDir, 'cursor', 'hooks', 'session-start.sh.template');
  const raw = await readFile(srcPath, 'utf8');
  const rendered = raw.replace(/\{\{RECALL_CMD\}\}/g, recallCommand(opts.flavor));

  let action: CopyCursorHookResult['action'] = 'created';
  if (existsSync(hookScriptPath)) {
    const existing = await readFile(hookScriptPath, 'utf8');
    action = existing === rendered ? 'unchanged' : 'updated';
  }
  if (action !== 'unchanged') {
    await writeFile(hookScriptPath, rendered, 'utf8');
    await chmod(hookScriptPath, 0o755);
  }
  return { hookScriptPath, hookCommand: `bash ${hookScriptPath}`, action };
}

interface CursorHookEntry {
  command: string;
}

interface CursorHooksFile {
  version?: number;
  hooks?: Record<string, CursorHookEntry[]>;
  [key: string]: unknown;
}

async function readHooksJson(path: string): Promise<CursorHooksFile> {
  if (!existsSync(path)) return {};
  const raw = await readFile(path, 'utf8');
  if (!raw.trim()) return {};
  return JSON.parse(raw) as CursorHooksFile;
}

async function writeHooksJson(path: string, data: CursorHooksFile): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const tmp = `${path}.tmp`;
  await writeFile(tmp, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
  await rename(tmp, path);
}

function isMetalmindEntry(entry: CursorHookEntry): boolean {
  return typeof entry?.command === 'string' && entry.command.includes(METALMIND_HOOK_MARKER);
}

export interface ApplyCursorHooksJsonOptions {
  hooksJsonPath?: string;
  hookCommand: string;
}

export interface ApplyCursorHooksJsonResult {
  hooksJsonPath: string;
  changed: boolean;
}

export async function applyCursorHooksJson(
  opts: ApplyCursorHooksJsonOptions,
): Promise<ApplyCursorHooksJsonResult> {
  const hooksJsonPath = opts.hooksJsonPath ?? join(DEFAULT_CURSOR_DIR, 'hooks.json');
  const data = await readHooksJson(hooksJsonPath);
  const hooks = data.hooks ?? {};
  const sessionStart = hooks.sessionStart ?? [];

  const other = sessionStart.filter((e) => !isMetalmindEntry(e));
  const existing = sessionStart.find(isMetalmindEntry);
  const alreadyCorrect = existing?.command === opts.hookCommand;

  if (alreadyCorrect && other.length === sessionStart.length - 1 && data.version === 1) {
    return { hooksJsonPath, changed: false };
  }

  hooks.sessionStart = [...other, { command: opts.hookCommand }];
  data.version = 1;
  data.hooks = hooks;
  await writeHooksJson(hooksJsonPath, data);
  return { hooksJsonPath, changed: true };
}

export async function clearCursorHooksJson(
  opts: { hooksJsonPath?: string } = {},
): Promise<boolean> {
  const hooksJsonPath = opts.hooksJsonPath ?? join(DEFAULT_CURSOR_DIR, 'hooks.json');
  if (!existsSync(hooksJsonPath)) return false;
  const data = await readHooksJson(hooksJsonPath);
  const hooks = data.hooks;
  if (!hooks || !Array.isArray(hooks.sessionStart)) return false;

  const filtered = hooks.sessionStart.filter((e) => !isMetalmindEntry(e));
  if (filtered.length === hooks.sessionStart.length) return false;

  if (filtered.length === 0) delete hooks.sessionStart;
  else hooks.sessionStart = filtered;
  if (Object.keys(hooks).length === 0) delete data.hooks;
  else data.hooks = hooks;

  if (!data.hooks && data.version !== undefined) delete data.version;
  if (Object.keys(data).length === 0) await unlink(hooksJsonPath);
  else await writeHooksJson(hooksJsonPath, data);
  return true;
}

/** Delete the metalmind Cursor hook script. Returns true if the file existed. */
export async function removeCursorHookScript(opts: { cursorDir?: string } = {}): Promise<boolean> {
  const cursorDir = opts.cursorDir ?? DEFAULT_CURSOR_DIR;
  const hookScriptPath = join(cursorDir, 'hooks', METALMIND_CURSOR_HOOK_FILENAME);
  if (!existsSync(hookScriptPath)) return false;
  await unlink(hookScriptPath);
  return true;
}
