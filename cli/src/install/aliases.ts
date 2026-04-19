import { existsSync } from 'node:fs';
import { appendFile, copyFile, mkdir, readFile, unlink, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { getTemplatesDir } from '../util/paths.js';

export const DEFAULT_ALIASES_DIR = join(homedir(), '.metalmind');
export const DEFAULT_ALIASES_PATH = join(DEFAULT_ALIASES_DIR, 'aliases.sh');
export const DEFAULT_ZSHRC = join(homedir(), '.zshrc');

export const ZSHRC_SOURCE_SENTINEL = '# metalmind aliases';

export interface InstallAliasesOptions {
  templatesDir?: string;
  aliasesPath?: string;
  zshrcPath?: string;
}

export interface InstallAliasesResult {
  aliasesPath: string;
  zshrcPath: string;
  wroteAliases: boolean;
  appendedSource: boolean;
  zshrcMissing: boolean;
}

export interface UninstallAliasesOptions {
  aliasesPath?: string;
  zshrcPath?: string;
}

export interface UninstallAliasesResult {
  removedAliases: boolean;
  removedSourceLine: boolean;
}

function sourceLineFor(aliasesPath: string): string {
  return `[ -f ${aliasesPath} ] && source ${aliasesPath}`;
}

export async function installAliases(
  opts: InstallAliasesOptions = {},
): Promise<InstallAliasesResult> {
  const templatesDir = opts.templatesDir ?? getTemplatesDir();
  const aliasesPath = opts.aliasesPath ?? DEFAULT_ALIASES_PATH;
  const zshrcPath = opts.zshrcPath ?? DEFAULT_ZSHRC;
  const aliasesDir = join(aliasesPath, '..');

  await mkdir(aliasesDir, { recursive: true });
  const src = join(templatesDir, 'zsh', 'aliases.sh');
  await copyFile(src, aliasesPath);
  const wroteAliases = true;

  const sourceLine = sourceLineFor(aliasesPath);
  const block = `\n${ZSHRC_SOURCE_SENTINEL}\n${sourceLine}\n`;

  if (!existsSync(zshrcPath)) {
    return { aliasesPath, zshrcPath, wroteAliases, appendedSource: false, zshrcMissing: true };
  }

  const current = await readFile(zshrcPath, 'utf8');
  if (current.includes(ZSHRC_SOURCE_SENTINEL)) {
    return { aliasesPath, zshrcPath, wroteAliases, appendedSource: false, zshrcMissing: false };
  }

  await appendFile(zshrcPath, block, 'utf8');
  return { aliasesPath, zshrcPath, wroteAliases, appendedSource: true, zshrcMissing: false };
}

export async function uninstallAliases(
  opts: UninstallAliasesOptions = {},
): Promise<UninstallAliasesResult> {
  const aliasesPath = opts.aliasesPath ?? DEFAULT_ALIASES_PATH;
  const zshrcPath = opts.zshrcPath ?? DEFAULT_ZSHRC;

  let removedAliases = false;
  if (existsSync(aliasesPath)) {
    await unlink(aliasesPath);
    removedAliases = true;
  }

  let removedSourceLine = false;
  if (existsSync(zshrcPath)) {
    const current = await readFile(zshrcPath, 'utf8');
    if (current.includes(ZSHRC_SOURCE_SENTINEL)) {
      const sourceLine = sourceLineFor(aliasesPath);
      const pattern = new RegExp(
        `\\n?${ZSHRC_SOURCE_SENTINEL}\\n${sourceLine.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\n?`,
      );
      const cleaned = current.replace(pattern, '\n');
      await writeFile(zshrcPath, cleaned.replace(/\n{3,}/g, '\n\n'), 'utf8');
      removedSourceLine = true;
    }
  }

  return { removedAliases, removedSourceLine };
}
