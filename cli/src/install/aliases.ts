import { existsSync } from 'node:fs';
import { appendFile, copyFile, mkdir, readFile, unlink, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { getTemplatesDir } from '../util/paths.js';

export const DEFAULT_ALIASES_DIR = join(homedir(), '.metalmind');
export const DEFAULT_ALIASES_PATH = join(DEFAULT_ALIASES_DIR, 'aliases.sh');
export const DEFAULT_ZSHRC = join(homedir(), '.zshrc');
export const DEFAULT_BASHRC = join(homedir(), '.bashrc');

export const RC_SOURCE_SENTINEL = '# metalmind aliases';
/** @deprecated use RC_SOURCE_SENTINEL */
export const ZSHRC_SOURCE_SENTINEL = RC_SOURCE_SENTINEL;

export interface InstallAliasesOptions {
  templatesDir?: string;
  aliasesPath?: string;
  /** Primary shell rc (zsh). Defaults to ~/.zshrc. */
  zshrcPath?: string;
  /** Bash rc. Defaults to ~/.bashrc. */
  bashrcPath?: string;
}

export interface InstallAliasesResult {
  aliasesPath: string;
  zshrcPath: string;
  bashrcPath: string;
  wroteAliases: boolean;
  appendedSource: boolean;
  appendedTo: string[];
  zshrcMissing: boolean;
}

export interface UninstallAliasesOptions {
  aliasesPath?: string;
  zshrcPath?: string;
  bashrcPath?: string;
}

export interface UninstallAliasesResult {
  removedAliases: boolean;
  removedSourceLine: boolean;
  removedFrom: string[];
}

function sourceLineFor(aliasesPath: string): string {
  return `[ -f ${aliasesPath} ] && source ${aliasesPath}`;
}

async function appendSourceBlock(rcPath: string, aliasesPath: string): Promise<boolean> {
  if (!existsSync(rcPath)) return false;
  const current = await readFile(rcPath, 'utf8');
  if (current.includes(RC_SOURCE_SENTINEL)) return false;
  const block = `\n${RC_SOURCE_SENTINEL}\n${sourceLineFor(aliasesPath)}\n`;
  await appendFile(rcPath, block, 'utf8');
  return true;
}

async function stripSourceBlock(rcPath: string, aliasesPath: string): Promise<boolean> {
  if (!existsSync(rcPath)) return false;
  const current = await readFile(rcPath, 'utf8');
  if (!current.includes(RC_SOURCE_SENTINEL)) return false;
  const sourceLine = sourceLineFor(aliasesPath);
  const pattern = new RegExp(
    `\\n?${RC_SOURCE_SENTINEL}\\n${sourceLine.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\n?`,
  );
  const cleaned = current.replace(pattern, '\n').replace(/\n{3,}/g, '\n\n');
  await writeFile(rcPath, cleaned, 'utf8');
  return true;
}

export async function installAliases(
  opts: InstallAliasesOptions = {},
): Promise<InstallAliasesResult> {
  const templatesDir = opts.templatesDir ?? getTemplatesDir();
  const aliasesPath = opts.aliasesPath ?? DEFAULT_ALIASES_PATH;
  const zshrcPath = opts.zshrcPath ?? DEFAULT_ZSHRC;
  const bashrcPath = opts.bashrcPath ?? DEFAULT_BASHRC;
  const aliasesDir = join(aliasesPath, '..');

  await mkdir(aliasesDir, { recursive: true });
  const src = join(templatesDir, 'zsh', 'aliases.sh');
  await copyFile(src, aliasesPath);
  const wroteAliases = true;

  const appendedTo: string[] = [];
  if (await appendSourceBlock(zshrcPath, aliasesPath)) appendedTo.push(zshrcPath);
  if (await appendSourceBlock(bashrcPath, aliasesPath)) appendedTo.push(bashrcPath);

  return {
    aliasesPath,
    zshrcPath,
    bashrcPath,
    wroteAliases,
    appendedSource: appendedTo.length > 0,
    appendedTo,
    zshrcMissing: !existsSync(zshrcPath) && !existsSync(bashrcPath),
  };
}

export async function uninstallAliases(
  opts: UninstallAliasesOptions = {},
): Promise<UninstallAliasesResult> {
  const aliasesPath = opts.aliasesPath ?? DEFAULT_ALIASES_PATH;
  const zshrcPath = opts.zshrcPath ?? DEFAULT_ZSHRC;
  const bashrcPath = opts.bashrcPath ?? DEFAULT_BASHRC;

  let removedAliases = false;
  if (existsSync(aliasesPath)) {
    await unlink(aliasesPath);
    removedAliases = true;
  }

  const removedFrom: string[] = [];
  if (await stripSourceBlock(zshrcPath, aliasesPath)) removedFrom.push(zshrcPath);
  if (await stripSourceBlock(bashrcPath, aliasesPath)) removedFrom.push(bashrcPath);

  return {
    removedAliases,
    removedSourceLine: removedFrom.length > 0,
    removedFrom,
  };
}
