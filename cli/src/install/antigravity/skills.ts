// Antigravity skills (~/.gemini/config/skills/<name>/SKILL.md).
//
// Same frontmatter shape as Cursor's (name + description, markdown body), so
// the Cursor skill sources are reused verbatim; only the destination differs.

import { existsSync } from 'node:fs';
import { copyFile, mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { getTemplatesDir } from '../../util/paths.js';
import { renderFlavorSentinels, renderSkillSentinels, resolvePartials } from '../templates.js';
import { DEFAULT_GEMINI_DIR, recallCommand } from './shared.js';

export const METALMIND_ANTIGRAVITY_SKILLS = [
  'metalmind-recall',
  'writing-vault-notes',
  'synod',
  'save',
  'sync',
  'save-sync',
] as const;
export type MetalmindAntigravitySkill = (typeof METALMIND_ANTIGRAVITY_SKILLS)[number];

const SOURCE: Record<MetalmindAntigravitySkill, '.shared' | 'codex' | 'cursor'> = {
  'metalmind-recall': 'cursor',
  'writing-vault-notes': '.shared',
  synod: '.shared',
  save: 'codex',
  sync: 'codex',
  'save-sync': 'codex',
};

async function copyTree(
  srcDir: string,
  destDir: string,
  render: (raw: string) => Promise<string>,
): Promise<void> {
  await mkdir(destDir, { recursive: true });
  for (const entry of await readdir(srcDir, { withFileTypes: true })) {
    const src = join(srcDir, entry.name);
    const dest = join(destDir, entry.name);
    if (entry.isDirectory()) await copyTree(src, dest, render);
    else if (entry.name.endsWith('.md'))
      await writeFile(dest, await render(await readFile(src, 'utf8')), 'utf8');
    else await copyFile(src, dest);
  }
}

export function antigravitySkillsRoot(geminiDir = DEFAULT_GEMINI_DIR): string {
  return join(geminiDir, 'config', 'skills');
}

export async function copyAntigravitySkills(opts: {
  flavor: 'scadrial' | 'classic';
  templatesDir?: string;
  geminiDir?: string;
  eodHook?: boolean;
  notifications?: boolean;
}): Promise<{ copied: MetalmindAntigravitySkill[] }> {
  const templatesDir = opts.templatesDir ?? getTemplatesDir();
  const root = antigravitySkillsRoot(opts.geminiDir);
  await mkdir(root, { recursive: true });
  const recall = recallCommand(opts.flavor);
  const render = async (raw: string) =>
    renderSkillSentinels(
      renderFlavorSentinels(await resolvePartials(raw, templatesDir), opts.flavor),
      { eodHook: opts.eodHook ?? true, notifications: opts.notifications ?? true },
    ).replace(/\{\{RECALL_CMD\}\}/g, recall);
  const copied: MetalmindAntigravitySkill[] = [];
  for (const skill of METALMIND_ANTIGRAVITY_SKILLS) {
    const tree = SOURCE[skill];
    const src = join(templatesDir, tree === '.shared' ? '.shared' : tree, 'skills', skill);
    if (!existsSync(src)) continue;
    await copyTree(src, join(root, skill), render);
    copied.push(skill);
  }
  return { copied };
}

export async function removeAntigravitySkills(
  opts: { geminiDir?: string } = {},
): Promise<MetalmindAntigravitySkill[]> {
  const root = antigravitySkillsRoot(opts.geminiDir);
  if (!existsSync(root)) return [];
  const removed: MetalmindAntigravitySkill[] = [];
  for (const skill of METALMIND_ANTIGRAVITY_SKILLS) {
    const path = join(root, skill);
    if (existsSync(path)) {
      await rm(path, { recursive: true, force: true });
      removed.push(skill);
    }
  }
  return removed;
}
