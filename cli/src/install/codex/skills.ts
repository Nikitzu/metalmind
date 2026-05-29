// Codex skills (~/.codex/skills/<name>/SKILL.md).
//
// Codex's skills format is identical to Claude Code's (frontmatter `name:`
// and `description:`, optional `metadata.short-description:`, markdown
// body). We ship writing-vault-notes, synod, and save (host-agnostic
// prompt content).
//
// using-teams is deliberately excluded — depends on CC's TeamCreate tool
// which Codex doesn't have.
//
// The `save` skill wraps `cli/templates/.shared/save-body.md` via the
// {{> ...}} partial-include preprocessor in templates.ts so its body stays
// byte-equal to CC's `commands/save.md` body section.

import { existsSync } from 'node:fs';
import { copyFile, mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { getTemplatesDir } from '../../util/paths.js';
import { renderFlavorSentinels, renderSkillSentinels, resolvePartials } from '../templates.js';
import { DEFAULT_CODEX_DIR, recallCommand } from './shared.js';

export const METALMIND_CODEX_SKILLS = ['writing-vault-notes', 'synod', 'save'] as const;
export type MetalmindCodexSkill = (typeof METALMIND_CODEX_SKILLS)[number];

// Per-skill source-tree mapping. Most skills live under
// cli/templates/.shared/skills/ (host-agnostic, single source of truth
// shared with copyClaudeTemplates). 'save' is Codex-specific because its
// frontmatter wraps the shared body partial differently from CC's slash
// command.
const CODEX_SKILL_SOURCE: Record<MetalmindCodexSkill, '.shared' | 'codex'> = {
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
      // Render only markdown — binary skill assets (icons, fonts) must be
      // copied byte-for-byte. Renderer composes resolvePartials (for
      // {{> .shared/...}} includes) + flavor-strip + sentinel-strip +
      // RECALL_CMD substitution.
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

export interface CopyCodexSkillsOptions {
  templatesDir?: string;
  codexDir?: string;
  flavor: 'scadrial' | 'classic';
  /** Strip the EOD-hook sentinel block when false. Defaults true (mirrors CC skills config). */
  eodHook?: boolean;
  /** Strip the macOS notifications sentinel block when false. Defaults true. */
  notifications?: boolean;
}

export interface CopyCodexSkillsResult {
  copied: MetalmindCodexSkill[];
}

export async function copyCodexSkills(
  opts: CopyCodexSkillsOptions,
): Promise<CopyCodexSkillsResult> {
  const templatesDir = opts.templatesDir ?? getTemplatesDir();
  const codexDir = opts.codexDir ?? DEFAULT_CODEX_DIR;
  const skillsRoot = join(codexDir, 'skills');
  const eodHook = opts.eodHook ?? true;
  const notifications = opts.notifications ?? true;
  await mkdir(skillsRoot, { recursive: true });

  const recall = recallCommand(opts.flavor);
  // Render chain (resolvePartials -> flavor sentinels -> skill sentinels ->
  // RECALL_CMD) mirrors the CC renderSave pipeline so save/SKILL.md (which
  // wraps the same .shared/save-body.md partial) ends up byte-identical to
  // CC's commands/save.md body.
  const render: AsyncRenderer = async (raw) => {
    const resolved = await resolvePartials(raw, templatesDir);
    const withFlavor = renderFlavorSentinels(resolved, opts.flavor);
    const withSkill = renderSkillSentinels(withFlavor, { eodHook, notifications });
    return withSkill.replace(/\{\{RECALL_CMD\}\}/g, recall);
  };

  const copied: MetalmindCodexSkill[] = [];
  for (const skill of METALMIND_CODEX_SKILLS) {
    const sourceTree = CODEX_SKILL_SOURCE[skill];
    const skillSrc =
      sourceTree === '.shared'
        ? join(templatesDir, '.shared', 'skills', skill)
        : join(templatesDir, 'codex', 'skills', skill);
    if (!existsSync(skillSrc)) continue;
    await copyTreeRecursive(skillSrc, join(skillsRoot, skill), render);
    copied.push(skill);
  }
  return { copied };
}

/** Remove metalmind-shipped skills from ~/.codex/skills/. Preserves user skills. */
export async function removeCodexSkills(
  opts: { codexDir?: string } = {},
): Promise<MetalmindCodexSkill[]> {
  const codexDir = opts.codexDir ?? DEFAULT_CODEX_DIR;
  const skillsRoot = join(codexDir, 'skills');
  if (!existsSync(skillsRoot)) return [];
  const removed: MetalmindCodexSkill[] = [];
  for (const skill of METALMIND_CODEX_SKILLS) {
    const path = join(skillsRoot, skill);
    if (existsSync(path)) {
      await rm(path, { recursive: true, force: true });
      removed.push(skill);
    }
  }
  return removed;
}
