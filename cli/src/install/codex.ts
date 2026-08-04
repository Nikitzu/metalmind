// Codex host-integration entry point.
//
// This file is a barrel - every public symbol re-exports from a focused
// per-section module under ./codex/. Keeps the import surface stable
// (`from '../install/codex.js'` still resolves) while letting each
// section live in a 60-150 line file with a single responsibility.
//
// Section map:
// - shared:       DEFAULT_CODEX_DIR, recallCommand
// - agents:       AGENTS.md sentinel-bounded block
// - hooks:        SessionStart hook script + hooks.json registration
// - network:      [sandbox_workspace_write] network_access stamp
// - rules:        ~/.codex/rules/metalmind.rules pre-approvals
// - skills:       ~/.codex/skills/<name>/ bundles
// - mcp:          opt-in `codex mcp add` wrapper
// - orchestrator: installCodex / uninstallCodex compositions

export {
  clearCodexAgentsMd,
  type StampCodexAgentsMdOptions,
  type StampCodexAgentsMdResult,
  stampCodexAgentsMd,
} from './codex/agents.js';
export {
  type ApplyCodexHooksJsonOptions,
  type ApplyCodexHooksJsonResult,
  applyCodexHooksJson,
  type CopyCodexHookOptions,
  type CopyCodexHookResult,
  clearCodexHooksJson,
  copyCodexHook,
  METALMIND_CODEX_HOOK_FILENAME,
  removeCodexHookScript,
} from './codex/hooks.js';
export {
  type AddCodexMcpServerOptions,
  type AddCodexMcpServerResult,
  addCodexMcpServer,
  DEFAULT_CODEX_MCP_NAME,
  DEFAULT_METALMIND_HTTP_URL,
  type RemoveCodexMcpServerOptions,
  type RemoveCodexMcpServerResult,
  removeCodexMcpServer,
} from './codex/mcp.js';

export {
  type ApplyCodexNetworkAccessOptions,
  type ApplyCodexNetworkAccessResult,
  applyCodexNetworkAccess,
  clearCodexNetworkAccess,
} from './codex/network.js';
export {
  type InstallCodexOptions,
  type InstallCodexResult,
  installCodex,
  type UninstallCodexOptions,
  type UninstallCodexResult,
  uninstallCodex,
} from './codex/orchestrator.js';
export {
  type CopyCodexPrefixRulesOptions,
  type CopyCodexPrefixRulesResult,
  copyCodexPrefixRules,
  METALMIND_RULES_FILENAME,
  removeCodexPrefixRules,
} from './codex/rules.js';
export { DEFAULT_CODEX_DIR, recallCommand } from './codex/shared.js';
export {
  type CopyCodexSkillsOptions,
  type CopyCodexSkillsResult,
  copyCodexSkills,
  METALMIND_CODEX_SKILLS,
  type MetalmindCodexSkill,
  removeCodexSkills,
} from './codex/skills.js';
