import { existsSync } from 'node:fs';
import {
  appendFile,
  chmod,
  copyFile,
  mkdir,
  readdir,
  readFile,
  unlink,
  writeFile,
} from 'node:fs/promises';
import { homedir } from 'node:os';
import { basename, dirname, join } from 'node:path';
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
  eodHook?: boolean;
  notifications?: boolean;
  /** Install only the memory surface: recall, scribe, the stamped block,
   *  and the rules. Skips subagents, team commands, and the deliberation
   *  skill so the thesis can be evaluated without the workflow layer. */
  core?: boolean;
}

/** Skill bundles the core install keeps. `metalmind-cli` is here because
 *  recall is unusable without the command reference, and `writing-vault-notes`
 *  because every note body goes through it. `using-teams` joins them when
 *  --teams is explicitly requested. */
const CORE_SKILLS = new Set(['metalmind-cli', 'writing-vault-notes']);

const SENTINEL_BLOCK_RE = (key: string) =>
  new RegExp(
    `\\n?<!--\\s*metalmind:${key}:start\\s*-->[\\s\\S]*?<!--\\s*metalmind:${key}:end\\s*-->\\n?`,
    'g',
  );
const SENTINEL_COMMENT_RE = (key: string) =>
  new RegExp(`\\n?<!--\\s*metalmind:${key}:(start|end)\\s*-->\\n?`, 'g');

export function renderSkillSentinels(
  source: string,
  flags: { eodHook: boolean; notifications: boolean },
): string {
  let out = source;
  if (!flags.eodHook) out = out.replace(SENTINEL_BLOCK_RE('eod'), '\n');
  if (!flags.notifications) out = out.replace(SENTINEL_BLOCK_RE('notifications'), '\n');
  out = out.replace(SENTINEL_COMMENT_RE('eod'), '\n');
  out = out.replace(SENTINEL_COMMENT_RE('notifications'), '\n');
  return out.replace(/\n{3,}/g, '\n\n');
}

// Skill bundles can carry parallel branches for both flavours of metalmind
// (e.g. persona labels in `synod`). At install time we keep the chosen
// flavour's branch and discard the other entirely, so the file on disk is
// flavour-pure - no runtime branching needed.
export function renderFlavorSentinels(source: string, flavor: 'scadrial' | 'classic'): string {
  const otherFlavor = flavor === 'scadrial' ? 'classic' : 'scadrial';
  let out = source;
  out = out.replace(SENTINEL_BLOCK_RE(`flavor-${otherFlavor}`), '\n');
  out = out.replace(SENTINEL_COMMENT_RE(`flavor-${flavor}`), '\n');
  return out.replace(/\n{3,}/g, '\n\n');
}

export interface CopyClaudeTemplatesResult {
  copied: string[];
  removed: string[];
  backedUp: string[];
  backupDir: string | null;
}

/**
 * Files we used to ship under `~/.claude/rules/` but have since retired.
 * On every `metalmind init` we remove them from the user's `claudeDir` so
 * old installs converge on the current template set. Safe by construction -
 * only files metalmind itself shipped are listed here.
 */
export const LEGACY_RULES_FILES = ['tool-philosophy.md'];

async function removeLegacyRules(claudeDir: string): Promise<string[]> {
  const removed: string[] = [];
  for (const name of LEGACY_RULES_FILES) {
    const target = join(claudeDir, 'rules', name);
    if (!existsSync(target)) continue;
    try {
      await unlink(target);
      removed.push(`rules/${name}`);
    } catch {
      // Best-effort: a permission error or race shouldn't break install.
    }
  }
  return removed;
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

// Renderer may be sync OR async - async needed for renderers that call
// resolvePartials (which reads files) to compose cleanly into the copy flow.
type SyncRenderer = (content: string) => string;
type Renderer = SyncRenderer | ((content: string) => Promise<string>);

const PARTIAL_INCLUDE_RE = /\{\{>\s*([^\s}]+)\s*\}\}/g;

/**
 * Resolve `{{> path/to/partial.md}}` includes by reading the partial relative
 * to `templatesDir`. Recursive (a partial may include another). Throws if a
 * referenced partial cannot be read.
 *
 * Used by template renderers (copyClaudeTemplates, copyCodexSkills) so a body
 * shared across hosts (e.g. `.shared/save-body.md`) lives once on disk and
 * can never drift between consumers.
 */
export async function resolvePartials(source: string, templatesDir: string): Promise<string> {
  const matches = [...source.matchAll(PARTIAL_INCLUDE_RE)];
  if (matches.length === 0) return source;
  let out = source;
  for (const match of matches) {
    const [whole, partialPath] = match;
    if (!partialPath) continue;
    const fullPath = join(templatesDir, partialPath);
    const partialRaw = await readFile(fullPath, 'utf8');
    const resolved = await resolvePartials(partialRaw, templatesDir);
    out = out.replace(whole, resolved);
  }
  return out;
}

async function backupIfDiverged(
  destPath: string,
  nextContent: string,
  backupDir: string | undefined,
  backedUp: string[],
): Promise<void> {
  if (!backupDir || !existsSync(destPath)) return;
  let current: string;
  try {
    current = await readFile(destPath, 'utf8');
  } catch {
    return;
  }
  if (current === nextContent) return;
  const rel = basename(destPath);
  const parent = basename(dirname(destPath));
  const target = join(backupDir, parent, rel);
  await mkdir(dirname(target), { recursive: true });
  await writeFile(target, current, 'utf8');
  backedUp.push(join(parent, rel));
}

async function copyDir(
  srcDir: string,
  destDir: string,
  filter: (name: string) => boolean,
  render?: (name: string) => Renderer | null,
  backupDir?: string,
  backedUp: string[] = [],
): Promise<{ copied: string[] }> {
  await mkdir(destDir, { recursive: true });
  const copied: string[] = [];
  const entries = await readdir(srcDir, { withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isFile() || !filter(entry.name)) continue;
    const srcPath = join(srcDir, entry.name);
    const destPath = join(destDir, entry.name);
    const renderer = render?.(entry.name);
    const raw = await readFile(srcPath, 'utf8');
    const next = renderer ? await renderer(raw) : raw;
    await backupIfDiverged(destPath, next, backupDir, backedUp);
    if (renderer) {
      await writeFile(destPath, next, 'utf8');
    } else {
      await copyFile(srcPath, destPath);
    }
    copied.push(entry.name);
  }
  return { copied };
}

async function copyTreeRecursive(
  srcDir: string,
  destDir: string,
  render?: Renderer,
): Promise<void> {
  await mkdir(destDir, { recursive: true });
  const entries = await readdir(srcDir, { withFileTypes: true });
  for (const entry of entries) {
    const srcPath = join(srcDir, entry.name);
    const destPath = join(destDir, entry.name);
    if (entry.isDirectory()) {
      await copyTreeRecursive(srcPath, destPath, render);
    } else if (entry.isFile()) {
      // Render only markdown - binary skill assets (icons, fonts) must be
      // copied byte-for-byte. The renderer is a no-op on files without
      // sentinel/placeholder markup, so it's safe to apply universally.
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

async function copySkillBundles(
  srcDir: string,
  destDir: string,
  render?: Renderer,
  keep?: (name: string) => boolean,
): Promise<{ copied: string[] }> {
  if (!existsSync(srcDir)) return { copied: [] };
  await mkdir(destDir, { recursive: true });
  const copied: string[] = [];
  const entries = await readdir(srcDir, { withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    if (keep && !keep(entry.name)) continue;
    const skillSrc = join(srcDir, entry.name);
    const skillDest = join(destDir, entry.name);
    await copyTreeRecursive(skillSrc, skillDest, render);
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
  const flavor = opts.flavor ?? 'scadrial';
  const recall = recallCommand(flavor);
  const eodHook = opts.eodHook ?? true;
  const notifications = opts.notifications ?? true;

  const renderRecall: SyncRenderer = (raw) => raw.replace(/\{\{RECALL_CMD\}\}/g, recall);
  // save.md uses {{> .shared/save-body.md}} to source its body from the
  // partial shared with Codex's skills/save/SKILL.md - extract once,
  // both hosts wrap it. Resolution must run BEFORE recall/sentinel
  // rendering so placeholders inside the partial get processed.
  const renderPartials: Renderer = async (raw) => {
    const resolved = await resolvePartials(raw, templatesDir);
    return renderSkillSentinels(renderRecall(resolved), { eodHook, notifications });
  };
  const renderSkill: SyncRenderer = (raw) => renderFlavorSentinels(renderRecall(raw), flavor);
  const PARTIAL_COMMANDS = new Set(['save.md', 'sync.md', 'save-sync.md']);

  const backedUp: string[] = [];
  const backupDir = join(
    claudeDir,
    'metalmind-backups',
    new Date().toISOString().slice(0, 19).replace(/:/g, ''),
  );

  const rules = await copyDir(
    join(srcRoot, 'rules'),
    join(claudeDir, 'rules'),
    (name) => name.endsWith('.md'),
    () => renderRecall,
    backupDir,
    backedUp,
  );
  const removedLegacy = await removeLegacyRules(claudeDir);
  // --core narrows defaults; it does not veto an explicit --teams. The team
  // commands dispatch subagents, so asking for teams has to bring the agents
  // with it or the commands land looking installed and fail on use.
  const withTeams = opts.withTeams === true;
  const core = opts.core === true && !withTeams;
  const agents = core
    ? { copied: [] }
    : await copyDir(
        join(srcRoot, 'agents'),
        join(claudeDir, 'agents'),
        (name) => name.endsWith('.md'),
        () => renderRecall,
        backupDir,
        backedUp,
      );
  const commands = await copyDir(
    join(srcRoot, 'commands'),
    join(claudeDir, 'commands'),
    (name) => PARTIAL_COMMANDS.has(name) || (withTeams && name.startsWith('team-')),
    (name) => (PARTIAL_COMMANDS.has(name) ? renderPartials : null),
  );
  // Skills come from two source trees:
  // - cli/templates/claude/skills/ - CC-specific bundles (using-teams,
  //   obsidian-markdown).
  // - cli/templates/.shared/skills/ - host-agnostic bundles shared with
  //   Codex (writing-vault-notes, synod). Single source of truth post-v0.8.1.
  const keepSkill = core ? (name: string) => CORE_SKILLS.has(name) : undefined;
  const ccSkills = await copySkillBundles(
    join(srcRoot, 'skills'),
    join(claudeDir, 'skills'),
    renderSkill,
    keepSkill,
  );
  const sharedSkills = await copySkillBundles(
    join(templatesDir, '.shared', 'skills'),
    join(claudeDir, 'skills'),
    renderSkill,
    keepSkill,
  );

  return {
    copied: [
      ...rules.copied.map((n) => `rules/${n}`),
      ...agents.copied.map((n) => `agents/${n}`),
      ...commands.copied.map((n) => `commands/${n}`),
      ...ccSkills.copied.map((n) => `skills/${n}`),
      ...sharedSkills.copied.map((n) => `skills/${n}`),
    ],
    removed: removedLegacy,
    backedUp,
    backupDir: backedUp.length > 0 ? backupDir : null,
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
  const resolvedBlock = await resolvePartials(blockSource, templatesDir);
  const rendered = resolvedBlock
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

  return {
    hookScriptPath,
    hookCommand: `bash ${hookScriptPath}`,
    action,
  };
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
