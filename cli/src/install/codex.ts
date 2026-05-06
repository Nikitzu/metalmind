import { existsSync } from 'node:fs';
import {
  chmod,
  copyFile,
  mkdir,
  readdir,
  readFile,
  rename,
  rm,
  unlink,
  writeFile,
} from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { getTemplatesDir } from '../util/paths.js';
import {
  removeSentinelBlock,
  type SentinelMarkers,
  type SentinelUpsertAction,
  upsertSentinelBlock,
} from '../util/sentinel.js';

export const DEFAULT_CODEX_DIR = join(homedir(), '.codex');

const CODEX_AGENTS_MARKERS: SentinelMarkers = {
  begin: '<!-- metalmind:codex:agents:begin -->',
  end: '<!-- metalmind:codex:agents:end -->',
};

export function recallCommand(flavor: 'scadrial' | 'classic'): string {
  return flavor === 'scadrial' ? 'metalmind tap copper' : 'metalmind recall';
}

export interface StampCodexAgentsMdOptions {
  vaultPath: string;
  flavor: 'scadrial' | 'classic';
  templatesDir?: string;
  codexDir?: string;
}

export interface StampCodexAgentsMdResult {
  path: string;
  blockAction: SentinelUpsertAction;
}

export async function stampCodexAgentsMd(
  opts: StampCodexAgentsMdOptions,
): Promise<StampCodexAgentsMdResult> {
  const templatesDir = opts.templatesDir ?? getTemplatesDir();
  const codexDir = opts.codexDir ?? DEFAULT_CODEX_DIR;
  const target = join(codexDir, 'AGENTS.md');

  await mkdir(codexDir, { recursive: true });

  const blockSource = await readFile(
    join(templatesDir, 'codex', 'AGENTS.md.block.template'),
    'utf8',
  );
  const rendered = blockSource
    .replace(/\{\{VAULT_PATH\}\}/g, opts.vaultPath)
    .replace(/\{\{RECALL_CMD\}\}/g, recallCommand(opts.flavor));

  const { action } = await upsertSentinelBlock({
    path: target,
    content: rendered,
    markers: CODEX_AGENTS_MARKERS,
  });

  return { path: target, blockAction: action };
}

export async function clearCodexAgentsMd(opts: { codexDir?: string } = {}): Promise<boolean> {
  const codexDir = opts.codexDir ?? DEFAULT_CODEX_DIR;
  const target = join(codexDir, 'AGENTS.md');
  if (!existsSync(target)) return false;
  const result = await removeSentinelBlock({
    path: target,
    markers: CODEX_AGENTS_MARKERS,
    deleteIfEmpty: true,
  });
  return result.action === 'removed' || result.action === 'file-empty';
}

// ---------------------------------------------------------------------------
// SessionStart hook (script + hooks.json registration)
// ---------------------------------------------------------------------------
//
// Codex's hook system is byte-identical to Claude Code's: same JSON shape,
// same events, same hookSpecificOutput.additionalContext payload (verified
// in the openai/codex Rust binary strings + app-server's CC->Codex migration
// logic). We reuse the existing CC session-start.sh.template script verbatim
// so there's exactly ONE hook implementation across both hosts.
//
// JSON has no comment syntax, so we identify our hooks.json entry by a
// marker substring in the command field — same pattern as
// applyMetalmindSessionStartHook in settings.ts.

export const METALMIND_CODEX_HOOK_FILENAME = 'metalmind-session-start.sh';
const METALMIND_HOOK_MARKER = METALMIND_CODEX_HOOK_FILENAME;

export interface CopyCodexHookOptions {
  templatesDir?: string;
  codexDir?: string;
  flavor: 'scadrial' | 'classic';
}

export interface CopyCodexHookResult {
  hookScriptPath: string;
  hookCommand: string;
  action: 'created' | 'updated' | 'unchanged';
}

export async function copyCodexHook(opts: CopyCodexHookOptions): Promise<CopyCodexHookResult> {
  const templatesDir = opts.templatesDir ?? getTemplatesDir();
  const codexDir = opts.codexDir ?? DEFAULT_CODEX_DIR;
  const hooksDir = join(codexDir, 'hooks');
  await mkdir(hooksDir, { recursive: true });

  const hookScriptPath = join(hooksDir, METALMIND_CODEX_HOOK_FILENAME);
  // Reuse CC's session-start.sh.template — Codex's SessionStart hook payload
  // (JSON shape, additionalContext field) is byte-identical to CC's. Single
  // source of truth; no parallel hook implementation.
  const srcPath = join(templatesDir, 'claude', 'hooks', 'session-start.sh.template');
  const raw = await readFile(srcPath, 'utf8');
  const rendered = raw.replace(/\{\{RECALL_CMD\}\}/g, recallCommand(opts.flavor));

  let action: CopyCodexHookResult['action'] = 'created';
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

interface CodexHookEntry {
  type: 'command';
  command: string;
}

interface CodexHookGroup {
  matcher?: string;
  hooks: CodexHookEntry[];
}

interface CodexHooksFile {
  hooks?: Record<string, CodexHookGroup[]>;
  [key: string]: unknown;
}

async function readHooksJson(path: string): Promise<CodexHooksFile> {
  if (!existsSync(path)) return {};
  const raw = await readFile(path, 'utf8');
  if (!raw.trim()) return {};
  return JSON.parse(raw) as CodexHooksFile;
}

async function writeHooksJson(path: string, data: CodexHooksFile): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const tmp = `${path}.tmp`;
  await writeFile(tmp, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
  await rename(tmp, path);
}

function isMetalmindHookGroup(group: CodexHookGroup): boolean {
  return group.hooks.some(
    (h) => typeof h?.command === 'string' && h.command.includes(METALMIND_HOOK_MARKER),
  );
}

export interface ApplyCodexHooksJsonOptions {
  hooksJsonPath?: string;
  hookCommand: string;
}

export interface ApplyCodexHooksJsonResult {
  hooksJsonPath: string;
  changed: boolean;
}

export async function applyCodexHooksJson(
  opts: ApplyCodexHooksJsonOptions,
): Promise<ApplyCodexHooksJsonResult> {
  const hooksJsonPath = opts.hooksJsonPath ?? join(DEFAULT_CODEX_DIR, 'hooks.json');
  const data = await readHooksJson(hooksJsonPath);
  const hooks = data.hooks ?? {};
  const sessionStart = hooks.SessionStart ?? [];

  const desired: CodexHookGroup = {
    matcher: '',
    hooks: [{ type: 'command', command: opts.hookCommand }],
  };

  const other = sessionStart.filter((g) => !isMetalmindHookGroup(g));
  const existing = sessionStart.find(isMetalmindHookGroup);
  const alreadyCorrect =
    existing !== undefined &&
    existing.hooks.length === 1 &&
    existing.hooks[0]?.command === opts.hookCommand;

  if (alreadyCorrect && other.length === sessionStart.length - 1) {
    return { hooksJsonPath, changed: false };
  }

  hooks.SessionStart = [...other, desired];
  data.hooks = hooks;
  await writeHooksJson(hooksJsonPath, data);
  return { hooksJsonPath, changed: true };
}

export async function clearCodexHooksJson(opts: { hooksJsonPath?: string } = {}): Promise<boolean> {
  const hooksJsonPath = opts.hooksJsonPath ?? join(DEFAULT_CODEX_DIR, 'hooks.json');
  if (!existsSync(hooksJsonPath)) return false;
  const data = await readHooksJson(hooksJsonPath);
  const hooks = data.hooks;
  if (!hooks || !Array.isArray(hooks.SessionStart)) return false;

  const filtered = hooks.SessionStart.filter((g) => !isMetalmindHookGroup(g));
  if (filtered.length === hooks.SessionStart.length) return false;

  if (filtered.length === 0) delete hooks.SessionStart;
  else hooks.SessionStart = filtered;
  if (Object.keys(hooks).length === 0) delete data.hooks;
  else data.hooks = hooks;

  if (Object.keys(data).length === 0) {
    await unlink(hooksJsonPath);
  } else {
    await writeHooksJson(hooksJsonPath, data);
  }
  return true;
}

/** Delete the metalmind-session-start.sh hook script. Returns true if the file existed. */
export async function removeCodexHookScript(opts: { codexDir?: string } = {}): Promise<boolean> {
  const codexDir = opts.codexDir ?? DEFAULT_CODEX_DIR;
  const hookScriptPath = join(codexDir, 'hooks', METALMIND_CODEX_HOOK_FILENAME);
  if (!existsSync(hookScriptPath)) return false;
  await unlink(hookScriptPath);
  return true;
}

// ---------------------------------------------------------------------------
// Sandbox network access ([sandbox_workspace_write] network_access = true)
// ---------------------------------------------------------------------------
//
// Codex's default workspace-write sandbox blocks loopback network. Without
// network_access=true, every `metalmind tap copper` call (loopback HTTP to
// 127.0.0.1:17317) fails with a network-proxy denial. We stamp this in a
// sentinel-bounded TOML block; sentinels use # line comments so TOML parses
// the file cleanly.
//
// Caveat: TOML semantics mean if the user has a competing
// [sandbox_workspace_write] table OUTSIDE our sentinels with
// network_access=false, the user's value wins and recall breaks. Documented
// in cookbook-codex.md.

const CODEX_NETWORK_MARKERS: SentinelMarkers = {
  begin: '# metalmind:codex:network:begin',
  end: '# metalmind:codex:network:end',
};

export interface ApplyCodexNetworkAccessOptions {
  templatesDir?: string;
  codexDir?: string;
}

export interface ApplyCodexNetworkAccessResult {
  configTomlPath: string;
  blockAction: SentinelUpsertAction;
}

export async function applyCodexNetworkAccess(
  opts: ApplyCodexNetworkAccessOptions = {},
): Promise<ApplyCodexNetworkAccessResult> {
  const templatesDir = opts.templatesDir ?? getTemplatesDir();
  const codexDir = opts.codexDir ?? DEFAULT_CODEX_DIR;
  const target = join(codexDir, 'config.toml');

  await mkdir(codexDir, { recursive: true });

  const blockSource = await readFile(
    join(templatesDir, 'codex', 'config.toml.network.template'),
    'utf8',
  );

  const { action } = await upsertSentinelBlock({
    path: target,
    content: blockSource,
    markers: CODEX_NETWORK_MARKERS,
  });

  return { configTomlPath: target, blockAction: action };
}

export async function clearCodexNetworkAccess(
  opts: { codexDir?: string } = {},
): Promise<boolean> {
  const codexDir = opts.codexDir ?? DEFAULT_CODEX_DIR;
  const target = join(codexDir, 'config.toml');
  if (!existsSync(target)) return false;
  const result = await removeSentinelBlock({
    path: target,
    markers: CODEX_NETWORK_MARKERS,
    deleteIfEmpty: true,
  });
  return result.action === 'removed' || result.action === 'file-empty';
}

// ---------------------------------------------------------------------------
// Pre-approved prefix rules (~/.codex/rules/metalmind.rules)
// ---------------------------------------------------------------------------
//
// Pre-approves the metalmind CLI surface so the first recall in a fresh
// Codex workspace doesn't hit an escalation prompt. metalmind owns the
// metalmind.rules file end-to-end (no sentinels needed; we write/delete the
// whole file). Codex auto-loads any *.rules file in ~/.codex/rules/ per
// codex-rs/core/src/exec_policy.rs:988.
//
// CRITICAL: never touch ~/.codex/rules/default.rules — that's Codex's own
// user-acceptance log (it appends user-approved escalations there per
// codex-rs/core/src/exec_policy.rs:399).

export const METALMIND_RULES_FILENAME = 'metalmind.rules';

export interface CopyCodexPrefixRulesOptions {
  templatesDir?: string;
  codexDir?: string;
}

export interface CopyCodexPrefixRulesResult {
  rulesPath: string;
  action: 'created' | 'updated' | 'unchanged';
}

export async function copyCodexPrefixRules(
  opts: CopyCodexPrefixRulesOptions = {},
): Promise<CopyCodexPrefixRulesResult> {
  const templatesDir = opts.templatesDir ?? getTemplatesDir();
  const codexDir = opts.codexDir ?? DEFAULT_CODEX_DIR;
  const rulesDir = join(codexDir, 'rules');
  await mkdir(rulesDir, { recursive: true });

  const rulesPath = join(rulesDir, METALMIND_RULES_FILENAME);
  const srcPath = join(templatesDir, 'codex', 'rules', METALMIND_RULES_FILENAME);
  const desired = await readFile(srcPath, 'utf8');

  let action: CopyCodexPrefixRulesResult['action'] = 'created';
  if (existsSync(rulesPath)) {
    const existing = await readFile(rulesPath, 'utf8');
    action = existing === desired ? 'unchanged' : 'updated';
  }
  if (action !== 'unchanged') {
    await writeFile(rulesPath, desired, 'utf8');
  }
  return { rulesPath, action };
}

/** Delete metalmind.rules. Never touches default.rules. */
export async function removeCodexPrefixRules(
  opts: { codexDir?: string } = {},
): Promise<boolean> {
  const codexDir = opts.codexDir ?? DEFAULT_CODEX_DIR;
  const rulesPath = join(codexDir, 'rules', METALMIND_RULES_FILENAME);
  if (!existsSync(rulesPath)) return false;
  await unlink(rulesPath);
  return true;
}

// ---------------------------------------------------------------------------
// Codex skills (~/.codex/skills/<name>/SKILL.md)
// ---------------------------------------------------------------------------
//
// Codex's skills format is identical to Claude Code's (frontmatter `name:`
// and `description:`, optional `metadata.short-description:`, markdown body).
// We ship writing-vault-notes and synod (host-agnostic prompt content).
//
// using-teams is deliberately excluded — depends on CC's TeamCreate tool
// which Codex doesn't have.
//
// The `save` skill is added in Phase 2 (Task 2.1) once the shared save-body
// partial is extracted.

export const METALMIND_CODEX_SKILLS = ['writing-vault-notes', 'synod'] as const;
export type MetalmindCodexSkill = (typeof METALMIND_CODEX_SKILLS)[number];

type Renderer = (raw: string) => string;

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
      // Render only markdown — binary skill assets (icons, fonts) must be
      // copied byte-for-byte. Renderer is a no-op on files without
      // placeholder markup, so safe-ish to apply universally; gate on
      // .md extension to be defensive.
      if (render && entry.name.endsWith('.md')) {
        const raw = await readFile(srcPath, 'utf8');
        await writeFile(destPath, render(raw), 'utf8');
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
  const srcRoot = join(templatesDir, 'codex', 'skills');
  await mkdir(skillsRoot, { recursive: true });

  const recall = recallCommand(opts.flavor);
  const render: Renderer = (raw) => raw.replace(/\{\{RECALL_CMD\}\}/g, recall);

  const copied: MetalmindCodexSkill[] = [];
  for (const skill of METALMIND_CODEX_SKILLS) {
    const skillSrc = join(srcRoot, skill);
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
