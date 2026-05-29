// Cursor install/uninstall orchestrators. Composes the per-section primitives
// in order; uninstall round-trips in reverse. Mirrors codex/orchestrator.ts.

import { join } from 'node:path';
import { copyCursorAgents, removeCursorAgents } from './agents.js';
import {
  applyCursorHooksJson,
  clearCursorHooksJson,
  copyCursorHook,
  removeCursorHookScript,
} from './hooks.js';
import { addCursorMcpServer, removeCursorMcpServer } from './mcp.js';
import { DEFAULT_CURSOR_DIR } from './shared.js';
import { copyCursorSkills, type MetalmindCursorSkill, removeCursorSkills } from './skills.js';

export interface InstallCursorOptions {
  vaultPath: string;
  flavor: 'scadrial' | 'classic';
  withMcp?: boolean;
  templatesDir?: string;
  cursorDir?: string;
}

export interface InstallCursorResult {
  skills: MetalmindCursorSkill[];
  agents: string[];
  hookScript: 'created' | 'updated' | 'unchanged';
  hooksJson: 'changed' | 'unchanged';
  mcp: 'added' | 'already-present' | 'skipped';
}

export async function installCursor(opts: InstallCursorOptions): Promise<InstallCursorResult> {
  const cursorDir = opts.cursorDir ?? DEFAULT_CURSOR_DIR;
  const shared = { templatesDir: opts.templatesDir, cursorDir };

  const skills = await copyCursorSkills({ flavor: opts.flavor, ...shared });
  const agents = await copyCursorAgents(shared);
  const hookScript = await copyCursorHook({ flavor: opts.flavor, ...shared });
  const hooksJson = await applyCursorHooksJson({
    hooksJsonPath: join(cursorDir, 'hooks.json'),
    hookCommand: hookScript.hookCommand,
  });

  let mcp: InstallCursorResult['mcp'] = 'skipped';
  if (opts.withMcp) {
    const result = await addCursorMcpServer({ mcpJsonPath: join(cursorDir, 'mcp.json') });
    mcp = result.action;
  }

  return {
    skills: skills.copied,
    agents: agents.copied,
    hookScript: hookScript.action,
    hooksJson: hooksJson.changed ? 'changed' : 'unchanged',
    mcp,
  };
}

export interface UninstallCursorOptions {
  cursorDir?: string;
  removeMcp?: boolean;
}

export interface UninstallCursorResult {
  skills: MetalmindCursorSkill[];
  agents: string[];
  hooksJson: boolean;
  hookScript: boolean;
  mcp: 'removed' | 'absent' | 'skipped';
}

export async function uninstallCursor(
  opts: UninstallCursorOptions = {},
): Promise<UninstallCursorResult> {
  const cursorDir = opts.cursorDir ?? DEFAULT_CURSOR_DIR;
  const removeMcp = opts.removeMcp ?? true;

  const skills = await removeCursorSkills({ cursorDir });
  const agents = await removeCursorAgents({ cursorDir });
  const hooksJson = await clearCursorHooksJson({ hooksJsonPath: join(cursorDir, 'hooks.json') });
  const hookScript = await removeCursorHookScript({ cursorDir });

  let mcp: UninstallCursorResult['mcp'] = 'skipped';
  if (removeMcp) {
    const result = await removeCursorMcpServer({ mcpJsonPath: join(cursorDir, 'mcp.json') });
    mcp = result.action;
  }

  return { skills, agents, hooksJson, hookScript, mcp };
}
