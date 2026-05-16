// Cursor subagents (~/.cursor/agents/*.md).
//
// Cursor reads Claude Code agent frontmatter (name/description/model) directly.
// We copy the metalmind specialist agents from cli/templates/claude/agents/
// as-is — the Cursor-only fields (readonly, is_background) default correctly.

import { existsSync } from 'node:fs';
import { copyFile, mkdir, readdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { getTemplatesDir } from '../../util/paths.js';
import { DEFAULT_CURSOR_DIR } from './shared.js';

export interface CopyCursorAgentsOptions {
  templatesDir?: string;
  cursorDir?: string;
}

export interface CopyCursorAgentsResult {
  copied: string[];
}

export async function copyCursorAgents(
  opts: CopyCursorAgentsOptions = {},
): Promise<CopyCursorAgentsResult> {
  const templatesDir = opts.templatesDir ?? getTemplatesDir();
  const cursorDir = opts.cursorDir ?? DEFAULT_CURSOR_DIR;
  const srcDir = join(templatesDir, 'claude', 'agents');
  const destDir = join(cursorDir, 'agents');
  await mkdir(destDir, { recursive: true });

  const copied: string[] = [];
  if (!existsSync(srcDir)) return { copied };
  for (const entry of await readdir(srcDir, { withFileTypes: true })) {
    if (entry.isFile() && entry.name.endsWith('.md')) {
      await copyFile(join(srcDir, entry.name), join(destDir, entry.name));
      copied.push(entry.name);
    }
  }
  return { copied };
}

/** Remove metalmind-shipped agents from ~/.cursor/agents/. Preserves user agents. */
export async function removeCursorAgents(
  opts: { templatesDir?: string; cursorDir?: string } = {},
): Promise<string[]> {
  const templatesDir = opts.templatesDir ?? getTemplatesDir();
  const cursorDir = opts.cursorDir ?? DEFAULT_CURSOR_DIR;
  const srcDir = join(templatesDir, 'claude', 'agents');
  const destDir = join(cursorDir, 'agents');
  if (!existsSync(srcDir) || !existsSync(destDir)) return [];

  const removed: string[] = [];
  for (const entry of await readdir(srcDir, { withFileTypes: true })) {
    if (!entry.isFile() || !entry.name.endsWith('.md')) continue;
    const target = join(destDir, entry.name);
    if (existsSync(target)) {
      await rm(target, { force: true });
      removed.push(entry.name);
    }
  }
  return removed;
}
