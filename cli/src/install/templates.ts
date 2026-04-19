import { existsSync } from 'node:fs';
import { appendFile, copyFile, mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { runCommand } from '../util/exec.js';
import { getTemplatesDir } from '../util/paths.js';
import { upsertSentinelBlock, type SentinelUpsertAction } from '../util/sentinel.js';

export const DEFAULT_CLAUDE_DIR = join(homedir(), '.claude');
export const DEFAULT_GITIGNORE_GLOBAL = join(homedir(), '.gitignore_global');
export const DEFAULT_GITIGNORE_PATTERNS = ['.claude/', '.serena/', 'CLAUDE.md', 'CLAUDE.local.md'];

export interface CopyClaudeTemplatesOptions {
  templatesDir?: string;
  claudeDir?: string;
  withTeams?: boolean;
  flavor?: 'scadrial' | 'classic';
}

export interface CopyClaudeTemplatesResult {
  copied: string[];
}

export interface StampClaudeMdOptions {
  vaultPath: string;
  flavor: 'scadrial' | 'classic';
  templatesDir?: string;
  claudeDir?: string;
}

export function recallCommand(flavor: 'scadrial' | 'classic'): string {
  return flavor === 'scadrial' ? 'metalmind tap copper' : 'metalmind recall';
}

export interface StampClaudeMdResult {
  path: string;
  blockAction: SentinelUpsertAction;
  starterWritten: boolean;
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

type Renderer = (content: string) => string;

async function copyDir(
  srcDir: string,
  destDir: string,
  filter: (name: string) => boolean,
  render?: (name: string) => Renderer | null,
): Promise<{ copied: string[] }> {
  await mkdir(destDir, { recursive: true });
  const copied: string[] = [];
  const entries = await readdir(srcDir, { withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isFile() || !filter(entry.name)) continue;
    const srcPath = join(srcDir, entry.name);
    const destPath = join(destDir, entry.name);
    const renderer = render?.(entry.name);
    if (renderer) {
      const raw = await readFile(srcPath, 'utf8');
      await writeFile(destPath, renderer(raw), 'utf8');
    } else {
      await copyFile(srcPath, destPath);
    }
    copied.push(entry.name);
  }
  return { copied };
}

export async function copyClaudeTemplates(
  opts: CopyClaudeTemplatesOptions = {},
): Promise<CopyClaudeTemplatesResult> {
  const templatesDir = opts.templatesDir ?? getTemplatesDir();
  const claudeDir = opts.claudeDir ?? DEFAULT_CLAUDE_DIR;
  const srcRoot = join(templatesDir, 'claude');
  const recall = recallCommand(opts.flavor ?? 'scadrial');

  const renderRecall: Renderer = (raw) => raw.replace(/\{\{RECALL_CMD\}\}/g, recall);

  const rules = await copyDir(
    join(srcRoot, 'rules'),
    join(claudeDir, 'rules'),
    (name) => name.endsWith('.md'),
    () => renderRecall,
  );
  const agents = await copyDir(
    join(srcRoot, 'agents'),
    join(claudeDir, 'agents'),
    (name) => name.endsWith('.md'),
    () => renderRecall,
  );
  const commands = await copyDir(
    join(srcRoot, 'commands'),
    join(claudeDir, 'commands'),
    (name) => name === 'save.md' || (opts.withTeams === true && name.startsWith('team-')),
    (name) => (name === 'save.md' ? renderRecall : null),
  );

  return {
    copied: [
      ...rules.copied.map((n) => `rules/${n}`),
      ...agents.copied.map((n) => `agents/${n}`),
      ...commands.copied.map((n) => `commands/${n}`),
    ],
  };
}

export async function stampClaudeMd(opts: StampClaudeMdOptions): Promise<StampClaudeMdResult> {
  const templatesDir = opts.templatesDir ?? getTemplatesDir();
  const claudeDir = opts.claudeDir ?? DEFAULT_CLAUDE_DIR;
  const target = join(claudeDir, 'CLAUDE.md');

  await mkdir(claudeDir, { recursive: true });

  let starterWritten = false;
  if (!existsSync(target)) {
    const starter = await readFile(
      join(templatesDir, 'claude', 'CLAUDE.md.starter.template'),
      'utf8',
    );
    await writeFile(target, starter, 'utf8');
    starterWritten = true;
  }

  const blockSource = await readFile(
    join(templatesDir, 'claude', 'CLAUDE.md.block.template'),
    'utf8',
  );
  const rendered = blockSource
    .replace(/\{\{VAULT_PATH\}\}/g, opts.vaultPath)
    .replace(/\{\{RECALL_CMD\}\}/g, recallCommand(opts.flavor));
  const { action } = await upsertSentinelBlock({ path: target, content: rendered });

  return { path: target, blockAction: action, starterWritten };
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
