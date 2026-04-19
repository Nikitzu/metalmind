import { existsSync } from 'node:fs';
import { appendFile, copyFile, mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { runCommand } from '../util/exec.js';
import { getTemplatesDir } from '../util/paths.js';

export const DEFAULT_CLAUDE_DIR = join(homedir(), '.claude');
export const DEFAULT_GITIGNORE_GLOBAL = join(homedir(), '.gitignore_global');
export const DEFAULT_GITIGNORE_PATTERNS = ['.claude/', '.serena/', 'CLAUDE.md', 'CLAUDE.local.md'];

export interface CopyClaudeTemplatesOptions {
  templatesDir?: string;
  claudeDir?: string;
  withTeams?: boolean;
}

export interface CopyClaudeTemplatesResult {
  copied: string[];
  skipped: string[];
}

export interface StampClaudeMdOptions {
  vaultPath: string;
  templatesDir?: string;
  claudeDir?: string;
}

export interface StampClaudeMdResult {
  path: string;
  wrote: boolean;
}

export interface AppendGlobalGitignoreOptions {
  patterns?: string[];
  gitignorePath?: string;
  skipGitConfig?: boolean;
}

export interface AppendGlobalGitignoreResult {
  path: string;
  added: string[];
  existing: string[];
}

async function copyDirNonDestructive(
  srcDir: string,
  destDir: string,
  filter: (name: string) => boolean,
): Promise<{ copied: string[]; skipped: string[] }> {
  await mkdir(destDir, { recursive: true });
  const copied: string[] = [];
  const skipped: string[] = [];
  const entries = await readdir(srcDir, { withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isFile() || !filter(entry.name)) continue;
    const destPath = join(destDir, entry.name);
    if (existsSync(destPath)) {
      skipped.push(entry.name);
      continue;
    }
    await copyFile(join(srcDir, entry.name), destPath);
    copied.push(entry.name);
  }
  return { copied, skipped };
}

export async function copyClaudeTemplates(
  opts: CopyClaudeTemplatesOptions = {},
): Promise<CopyClaudeTemplatesResult> {
  const templatesDir = opts.templatesDir ?? getTemplatesDir();
  const claudeDir = opts.claudeDir ?? DEFAULT_CLAUDE_DIR;
  const srcRoot = join(templatesDir, 'claude');

  const rules = await copyDirNonDestructive(
    join(srcRoot, 'rules'),
    join(claudeDir, 'rules'),
    (name) => name.endsWith('.md'),
  );
  const agents = await copyDirNonDestructive(
    join(srcRoot, 'agents'),
    join(claudeDir, 'agents'),
    (name) => name.endsWith('.md'),
  );
  const commands = await copyDirNonDestructive(
    join(srcRoot, 'commands'),
    join(claudeDir, 'commands'),
    (name) => name === 'save.md' || (opts.withTeams === true && name.startsWith('team-')),
  );

  return {
    copied: [
      ...rules.copied.map((n) => `rules/${n}`),
      ...agents.copied.map((n) => `agents/${n}`),
      ...commands.copied.map((n) => `commands/${n}`),
    ],
    skipped: [
      ...rules.skipped.map((n) => `rules/${n}`),
      ...agents.skipped.map((n) => `agents/${n}`),
      ...commands.skipped.map((n) => `commands/${n}`),
    ],
  };
}

export async function stampClaudeMd(opts: StampClaudeMdOptions): Promise<StampClaudeMdResult> {
  const templatesDir = opts.templatesDir ?? getTemplatesDir();
  const claudeDir = opts.claudeDir ?? DEFAULT_CLAUDE_DIR;
  const target = join(claudeDir, 'CLAUDE.md');

  if (existsSync(target)) {
    return { path: target, wrote: false };
  }

  await mkdir(claudeDir, { recursive: true });
  const template = await readFile(join(templatesDir, 'claude', 'CLAUDE.md.template'), 'utf8');
  const rendered = template.replace(/\{\{VAULT_PATH\}\}/g, opts.vaultPath);
  await writeFile(target, rendered, 'utf8');
  return { path: target, wrote: true };
}

export async function appendGlobalGitignore(
  opts: AppendGlobalGitignoreOptions = {},
): Promise<AppendGlobalGitignoreResult> {
  const patterns = opts.patterns ?? DEFAULT_GITIGNORE_PATTERNS;
  let path = opts.gitignorePath;

  if (!path && !opts.skipGitConfig) {
    const res = await runCommand('git', ['config', '--global', '--get', 'core.excludesfile']);
    path = res.ok && res.stdout.trim() ? res.stdout.trim() : DEFAULT_GITIGNORE_GLOBAL;
  }
  const finalPath = path ?? DEFAULT_GITIGNORE_GLOBAL;

  if (!existsSync(finalPath)) {
    await writeFile(finalPath, '', 'utf8');
  }

  if (!opts.skipGitConfig) {
    await runCommand('git', ['config', '--global', 'core.excludesfile', finalPath]);
  }

  const current = await readFile(finalPath, 'utf8');
  const currentLines = new Set(current.split('\n').map((l) => l.trim()));
  const added: string[] = [];
  const existing: string[] = [];
  let appendBuffer = '';
  for (const pattern of patterns) {
    if (currentLines.has(pattern)) {
      existing.push(pattern);
    } else {
      added.push(pattern);
      appendBuffer += `${pattern}\n`;
    }
  }
  if (appendBuffer) {
    const needsLeadingNewline = current.length > 0 && !current.endsWith('\n');
    await appendFile(finalPath, `${needsLeadingNewline ? '\n' : ''}${appendBuffer}`, 'utf8');
  }

  return { path: finalPath, added, existing };
}
