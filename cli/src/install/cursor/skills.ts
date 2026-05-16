// Cursor skills (~/.cursor/skills/<name>/SKILL.md).
//
// Cursor's skills format takes frontmatter `name:` and `description:` plus a
// markdown body. It has no `model:` field (unlike Claude Code), so the
// vault-writing skills run on the session model.
//
// We ship metalmind-recall (the recall backbone — Cursor auto-discovers it
// and the agent self-invokes it), plus writing-vault-notes, synod, and save.
//
// metalmind-recall is Cursor-specific (cli/templates/cursor/skills/). The
// other three reuse the same sources copyCodexSkills uses: writing-vault-notes
// and synod from cli/templates/.shared/skills/, save from
// cli/templates/codex/skills/ (its frontmatter wraps the shared save-body
// partial).

import { existsSync } from 'node:fs';
import { copyFile, mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { getTemplatesDir } from '../../util/paths.js';
import {
  renderFlavorSentinels,
  renderSkillSentinels,
  resolvePartials,
} from '../templates.js';
import { DEFAULT_CURSOR_DIR, recallCommand } from './shared.js';

export const METALMIND_CURSOR_SKILLS = [
  'metalmind-recall',
  'writing-vault-notes',
  'synod',
  'save',
] as const;
export type MetalmindCursorSkill = (typeof METALMIND_CURSOR_SKILLS)[number];

// Per-skill source-tree mapping. '.shared' = host-agnostic single source of
// truth; 'codex' = Codex-shaped frontmatter reused verbatim; 'cursor' =
// Cursor-specific.
const CURSOR_SKILL_SOURCE: Record<MetalmindCursorSkill, '.shared' | 'codex' | 'cursor'> = {
  'metalmind-recall': 'cursor',
  'writing-vault-notes': '.shared',
  synod: '.shared',
  save: 'codex',
};

type AsyncRenderer = (raw: string) => Promise<string>;

async function copyTreeRecursive(
  srcDir: string,
  destDir: string,
  render?: AsyncRenderer,
): Promise<void> {
  await mkdir(destDir, { recursive: true });
  const entries = await readdir(srcDir, { withFileTypes: true });
  for (const entry of entries) {
    const srcPath = join(srcDir, entry.name);
    const destPath = join(destDir, entry.name);
    if (entry.isDirectory()) {
      await copyTreeRecursive(srcPath, destPath, render);
    } else if (entry.isFile()) {
      // Render only markdown — binary skill assets must be copied byte-for-byte.
      if (render && entry.name.endsWith('.md')) {
        const raw = await readFile(srcPath, 'utf8');
        const rendered = await render(raw);
        await writeFile(destPath, rendered, 'utf8');
      } else {
        await copyFile(srcPath, destPath);
      }
    }
  }
}

export interface CopyCursorSkillsOptions {
  templatesDir?: string;
  cursorDir?: string;
  flavor: 'scadrial' | 'classic';
  /** Strip the EOD-hook sentinel block when false. Defaults true. */
  eodHook?: boolean;
  /** Strip the macOS notifications sentinel block when false. Defaults true. */
  notifications?: boolean;
}

export interface CopyCursorSkillsResult {
  copied: MetalmindCursorSkill[];
}

export async function copyCursorSkills(
  opts: CopyCursorSkillsOptions,
): Promise<CopyCursorSkillsResult> {
  const templatesDir = opts.templatesDir ?? getTemplatesDir();
  const cursorDir = opts.cursorDir ?? DEFAULT_CURSOR_DIR;
  const skillsRoot = join(cursorDir, 'skills');
  const eodHook = opts.eodHook ?? true;
  const notifications = opts.notifications ?? true;
  await mkdir(skillsRoot, { recursive: true });

  const recall = recallCommand(opts.flavor);
  const render: AsyncRenderer = async (raw) => {
    const resolved = await resolvePartials(raw, templatesDir);
    const withFlavor = renderFlavorSentinels(resolved, opts.flavor);
    const withSkill = renderSkillSentinels(withFlavor, { eodHook, notifications });
    return withSkill.replace(/\{\{RECALL_CMD\}\}/g, recall);
  };

  const copied: MetalmindCursorSkill[] = [];
  for (const skill of METALMIND_CURSOR_SKILLS) {
    const sourceTree = CURSOR_SKILL_SOURCE[skill];
    const skillSrc =
      sourceTree === '.shared'
        ? join(templatesDir, '.shared', 'skills', skill)
        : join(templatesDir, sourceTree, 'skills', skill);
    if (!existsSync(skillSrc)) continue;
    await copyTreeRecursive(skillSrc, join(skillsRoot, skill), render);
    copied.push(skill);
  }
  return { copied };
}

/** Remove metalmind-shipped skills from ~/.cursor/skills/. Preserves user skills. */
export async function removeCursorSkills(
  opts: { cursorDir?: string } = {},
): Promise<MetalmindCursorSkill[]> {
  const cursorDir = opts.cursorDir ?? DEFAULT_CURSOR_DIR;
  const skillsRoot = join(cursorDir, 'skills');
  if (!existsSync(skillsRoot)) return [];
  const removed: MetalmindCursorSkill[] = [];
  for (const skill of METALMIND_CURSOR_SKILLS) {
    const path = join(skillsRoot, skill);
    if (existsSync(path)) {
      await rm(path, { recursive: true, force: true });
      removed.push(skill);
    }
  }
  return removed;
}
