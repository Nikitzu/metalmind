// Codex install/uninstall orchestrators.
//
// installCodex composes all per-section primitives in the right order; used
// by init/stamp via the host-dispatch flow. uninstallCodex round-trips the
// install in reverse order (and tolerates a missing codex binary so
// uninstall succeeds in offline / partial-install scenarios).
//
// Both return structured results so the caller can render granular per-step
// status without coupling to the inner functions.

import { join } from 'node:path';
import type { SentinelUpsertAction } from '../../util/sentinel.js';
import {
  clearCodexAgentsMd,
  stampCodexAgentsMd,
} from './agents.js';
import {
  applyCodexHooksJson,
  clearCodexHooksJson,
  copyCodexHook,
  removeCodexHookScript,
} from './hooks.js';
import {
  addCodexMcpServer,
  removeCodexMcpServer,
} from './mcp.js';
import {
  applyCodexNetworkAccess,
  clearCodexNetworkAccess,
} from './network.js';
import {
  copyCodexPrefixRules,
  removeCodexPrefixRules,
} from './rules.js';
import { DEFAULT_CODEX_DIR } from './shared.js';
import {
  copyCodexSkills,
  type MetalmindCodexSkill,
  removeCodexSkills,
} from './skills.js';

export interface InstallCodexOptions {
  vaultPath: string;
  flavor: 'scadrial' | 'classic';
  /** Strip the EOD-hook sentinel block when false. Defaults true. */
  eodHook?: boolean;
  /** Strip the macOS notifications sentinel block when false. Defaults true. */
  notifications?: boolean;
  /** Opt-in MCP registration via `codex mcp add`. Off by default. */
  withMcp?: boolean;
  templatesDir?: string;
  codexDir?: string;
  /** Override the codex binary path; defaults to `codex` on PATH. */
  codexBin?: string;
}

export interface InstallCodexResult {
  agentsMd: SentinelUpsertAction;
  hookScript: 'created' | 'updated' | 'unchanged';
  hooksJson: 'changed' | 'unchanged';
  networkAccess: SentinelUpsertAction;
  prefixRules: 'created' | 'updated' | 'unchanged';
  skills: MetalmindCodexSkill[];
  mcp: 'added' | 'already-present' | 'codex-not-found' | 'skipped';
}

export async function installCodex(opts: InstallCodexOptions): Promise<InstallCodexResult> {
  const sharedOpts = {
    templatesDir: opts.templatesDir,
    codexDir: opts.codexDir,
  };

  const agentsMd = await stampCodexAgentsMd({
    vaultPath: opts.vaultPath,
    flavor: opts.flavor,
    ...sharedOpts,
  });

  const hookScript = await copyCodexHook({
    flavor: opts.flavor,
    ...sharedOpts,
  });

  const codexDir = opts.codexDir ?? DEFAULT_CODEX_DIR;
  const hooksJson = await applyCodexHooksJson({
    hooksJsonPath: join(codexDir, 'hooks.json'),
    hookCommand: hookScript.hookCommand,
  });

  const networkAccess = await applyCodexNetworkAccess(sharedOpts);
  const prefixRules = await copyCodexPrefixRules(sharedOpts);
  const skills = await copyCodexSkills({
    flavor: opts.flavor,
    eodHook: opts.eodHook,
    notifications: opts.notifications,
    ...sharedOpts,
  });

  let mcp: InstallCodexResult['mcp'] = 'skipped';
  if (opts.withMcp) {
    const result = await addCodexMcpServer({ codexBin: opts.codexBin });
    mcp = result.action;
  }

  return {
    agentsMd: agentsMd.blockAction,
    hookScript: hookScript.action,
    hooksJson: hooksJson.changed ? 'changed' : 'unchanged',
    networkAccess: networkAccess.blockAction,
    prefixRules: prefixRules.action,
    skills: skills.copied,
    mcp,
  };
}

export interface UninstallCodexOptions {
  codexDir?: string;
  /** When true, also call `codex mcp remove metalmind`. Defaults true. */
  removeMcp?: boolean;
  codexBin?: string;
}

export interface UninstallCodexResult {
  agentsMd: boolean;
  hooksJson: boolean;
  hookScript: boolean;
  networkAccess: boolean;
  prefixRules: boolean;
  skills: MetalmindCodexSkill[];
  mcp: 'removed' | 'absent' | 'codex-not-found' | 'skipped';
}

export async function uninstallCodex(
  opts: UninstallCodexOptions = {},
): Promise<UninstallCodexResult> {
  const codexDir = opts.codexDir ?? DEFAULT_CODEX_DIR;
  const removeMcp = opts.removeMcp ?? true;

  const agentsMd = await clearCodexAgentsMd({ codexDir });
  const hooksJson = await clearCodexHooksJson({
    hooksJsonPath: join(codexDir, 'hooks.json'),
  });
  const hookScript = await removeCodexHookScript({ codexDir });
  const networkAccess = await clearCodexNetworkAccess({ codexDir });
  const prefixRules = await removeCodexPrefixRules({ codexDir });
  const skills = await removeCodexSkills({ codexDir });

  let mcp: UninstallCodexResult['mcp'] = 'skipped';
  if (removeMcp) {
    const result = await removeCodexMcpServer({ codexBin: opts.codexBin });
    mcp = result.action;
  }

  return { agentsMd, hooksJson, hookScript, networkAccess, prefixRules, skills, mcp };
}
