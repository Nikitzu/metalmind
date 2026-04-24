import { existsSync } from 'node:fs';
import { appendFile, chmod, copyFile, mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { runCommand } from '../util/exec.js';
import { getTemplatesDir } from '../util/paths.js';
import { type SentinelUpsertAction, upsertSentinelBlock } from '../util/sentinel.js';

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

export interface CopyClaudeHooksOptions {
  templatesDir?: string;
  hooksDir?: string;
  flavor: 'scadrial' | 'classic';
}

export interface CopyClaudeHooksResult {
  hookScriptPath: string;
  hookCommand: string;
  action: 'created' | 'updated' | 'unchanged';
}

export const METALMIND_HOOK_FILENAME = 'metalmind-session-start.sh';

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

async function copyTreeRecursive(srcDir: string, destDir: string): Promise<void> {
  await mkdir(destDir, { recursive: true });
  const entries = await readdir(srcDir, { withFileTypes: true });
  for (const entry of entries) {
    const srcPath = join(srcDir, entry.name);
    const destPath = join(destDir, entry.name);
    if (entry.isDirectory()) {
      await copyTreeRecursive(srcPath, destPath);
    } else if (entry.isFile()) {
      await copyFile(srcPath, destPath);
    }
  }
}

async function copySkillBundles(srcDir: string, destDir: string): Promise<{ copied: string[] }> {
  if (!existsSync(srcDir)) return { copied: [] };
  await mkdir(destDir, { recursive: true });
  const copied: string[] = [];
  const entries = await readdir(srcDir, { withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const skillSrc = join(srcDir, entry.name);
    const skillDest = join(destDir, entry.name);
    await copyTreeRecursive(skillSrc, skillDest);
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
  const skills = await copySkillBundles(join(srcRoot, 'skills'), join(claudeDir, 'skills'));

  return {
    copied: [
      ...rules.copied.map((n) => `rules/${n}`),
      ...agents.copied.map((n) => `agents/${n}`),
      ...commands.copied.map((n) => `commands/${n}`),
      ...skills.copied.map((n) => `skills/${n}`),
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

export async function copyClaudeHooks(
  opts: CopyClaudeHooksOptions,
): Promise<CopyClaudeHooksResult> {
  const templatesDir = opts.templatesDir ?? getTemplatesDir();
  const hooksDir = opts.hooksDir ?? join(homedir(), '.claude', 'hooks');
  await mkdir(hooksDir, { recursive: true });

  const hookScriptPath = join(hooksDir, METALMIND_HOOK_FILENAME);
  const srcPath = join(templatesDir, 'claude', 'hooks', 'session-start.sh.template');
  const raw = await readFile(srcPath, 'utf8');
  const rendered = raw.replace(/\{\{RECALL_CMD\}\}/g, recallCommand(opts.flavor));

  let action: CopyClaudeHooksResult['action'] = 'created';
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

export async function appendGlobalGitignore(
  opts: AppendGlobalGitignoreOptions = {},
): Promise<AppendGlobalGitignoreResult> {
  const patterns = opts.patterns ?? DEFAULT_GITIGNORE_PATTERNS;
  let path = opts.gitignorePath;

  let existingExcludes = '';
  if (!path && !opts.skipGitConfig) {
    const res = await runCommand('git', ['config', '--global', '--get', 'core.excludesfile']);
    existingExcludes = res.ok ? res.stdout.trim() : '';
    path = existingExcludes || DEFAULT_GITIGNORE_GLOBAL;
  }
  const finalPath = path ?? DEFAULT_GITIGNORE_GLOBAL;

  if (!existsSync(finalPath)) {
    await writeFile(finalPath, '', 'utf8');
  }

  // Only touch git config when it's missing or pointing somewhere else.
  // The user rule "NEVER update the git config" means: don't overwrite the
  // user's choice. Setting an unset value is fine; overwriting is not.
  if (!opts.skipGitConfig && existingExcludes !== finalPath) {
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
