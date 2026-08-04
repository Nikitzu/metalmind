// SessionStart hook for Codex.
//
// Codex's hook system is byte-identical to Claude Code's: same JSON shape,
// same events, same hookSpecificOutput.additionalContext payload (verified
// in the openai/codex Rust binary strings + app-server's CC->Codex
// migration logic). We reuse the existing CC session-start.sh.template
// script verbatim - single source of truth across both hosts.
//
// JSON has no comment syntax, so we identify our hooks.json entry by a
// marker substring in the command field - same pattern as
// applyMetalmindSessionStartHook in settings.ts.

import { existsSync } from 'node:fs';
import { chmod, mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { getTemplatesDir } from '../../util/paths.js';
import { DEFAULT_CODEX_DIR, recallCommand } from './shared.js';

export const METALMIND_CODEX_HOOK_FILENAME = 'metalmind-session-start.sh';
const METALMIND_HOOK_MARKER = METALMIND_CODEX_HOOK_FILENAME;

export interface CopyCodexHookOptions {
  templatesDir?: string;
  codexDir?: string;
  flavor: 'scadrial' | 'classic';
}

export interface CopyCodexHookResult {
  hookScriptPath: string;
  hookCommand: string;
  action: 'created' | 'updated' | 'unchanged';
}

export async function copyCodexHook(opts: CopyCodexHookOptions): Promise<CopyCodexHookResult> {
  const templatesDir = opts.templatesDir ?? getTemplatesDir();
  const codexDir = opts.codexDir ?? DEFAULT_CODEX_DIR;
  const hooksDir = join(codexDir, 'hooks');
  await mkdir(hooksDir, { recursive: true });

  const hookScriptPath = join(hooksDir, METALMIND_CODEX_HOOK_FILENAME);
  const srcPath = join(templatesDir, 'claude', 'hooks', 'session-start.sh.template');
  const raw = await readFile(srcPath, 'utf8');
  const rendered = raw.replace(/\{\{RECALL_CMD\}\}/g, recallCommand(opts.flavor));

  let action: CopyCodexHookResult['action'] = 'created';
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

interface CodexHookEntry {
  type: 'command';
  command: string;
}

interface CodexHookGroup {
  matcher?: string;
  hooks: CodexHookEntry[];
}

interface CodexHooksFile {
  hooks?: Record<string, CodexHookGroup[]>;
  [key: string]: unknown;
}

async function readHooksJson(path: string): Promise<CodexHooksFile> {
  if (!existsSync(path)) return {};
  const raw = await readFile(path, 'utf8');
  if (!raw.trim()) return {};
  return JSON.parse(raw) as CodexHooksFile;
}

async function writeHooksJson(path: string, data: CodexHooksFile): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const tmp = `${path}.tmp`;
  await writeFile(tmp, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
  await rename(tmp, path);
}

function isMetalmindHookGroup(group: CodexHookGroup): boolean {
  return group.hooks.some(
    (h) => typeof h?.command === 'string' && h.command.includes(METALMIND_HOOK_MARKER),
  );
}

export interface ApplyCodexHooksJsonOptions {
  hooksJsonPath?: string;
  hookCommand: string;
}

export interface ApplyCodexHooksJsonResult {
  hooksJsonPath: string;
  changed: boolean;
}

export async function applyCodexHooksJson(
  opts: ApplyCodexHooksJsonOptions,
): Promise<ApplyCodexHooksJsonResult> {
  const hooksJsonPath = opts.hooksJsonPath ?? join(DEFAULT_CODEX_DIR, 'hooks.json');
  const data = await readHooksJson(hooksJsonPath);
  const hooks = data.hooks ?? {};
  const sessionStart = hooks.SessionStart ?? [];

  const desired: CodexHookGroup = {
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
    return { hooksJsonPath, changed: false };
  }

  hooks.SessionStart = [...other, desired];
  data.hooks = hooks;
  await writeHooksJson(hooksJsonPath, data);
  return { hooksJsonPath, changed: true };
}

export async function clearCodexHooksJson(opts: { hooksJsonPath?: string } = {}): Promise<boolean> {
  const hooksJsonPath = opts.hooksJsonPath ?? join(DEFAULT_CODEX_DIR, 'hooks.json');
  if (!existsSync(hooksJsonPath)) return false;
  const data = await readHooksJson(hooksJsonPath);
  const hooks = data.hooks;
  if (!hooks || !Array.isArray(hooks.SessionStart)) return false;

  const filtered = hooks.SessionStart.filter((g) => !isMetalmindHookGroup(g));
  if (filtered.length === hooks.SessionStart.length) return false;

  if (filtered.length === 0) delete hooks.SessionStart;
  else hooks.SessionStart = filtered;
  if (Object.keys(hooks).length === 0) delete data.hooks;
  else data.hooks = hooks;

  if (Object.keys(data).length === 0) {
    await unlink(hooksJsonPath);
  } else {
    await writeHooksJson(hooksJsonPath, data);
  }
  return true;
}

/** Delete the metalmind-session-start.sh hook script. Returns true if the file existed. */
export async function removeCodexHookScript(opts: { codexDir?: string } = {}): Promise<boolean> {
  const codexDir = opts.codexDir ?? DEFAULT_CODEX_DIR;
  const hookScriptPath = join(codexDir, 'hooks', METALMIND_CODEX_HOOK_FILENAME);
  if (!existsSync(hookScriptPath)) return false;
  await unlink(hookScriptPath);
  return true;
}
