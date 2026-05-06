// Codex host-integration entry point.
//
// This file is a barrel — every public symbol re-exports from a focused
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

export { DEFAULT_CODEX_DIR, recallCommand } from './codex/shared.js';

export {
  clearCodexAgentsMd,
  stampCodexAgentsMd,
  type StampCodexAgentsMdOptions,
  type StampCodexAgentsMdResult,
} from './codex/agents.js';

export {
  applyCodexHooksJson,
  clearCodexHooksJson,
  copyCodexHook,
  METALMIND_CODEX_HOOK_FILENAME,
  removeCodexHookScript,
  type ApplyCodexHooksJsonOptions,
  type ApplyCodexHooksJsonResult,
  type CopyCodexHookOptions,
  type CopyCodexHookResult,
} from './codex/hooks.js';

export {
  applyCodexNetworkAccess,
  clearCodexNetworkAccess,
  type ApplyCodexNetworkAccessOptions,
  type ApplyCodexNetworkAccessResult,
} from './codex/network.js';

export {
  copyCodexPrefixRules,
  METALMIND_RULES_FILENAME,
  removeCodexPrefixRules,
  type CopyCodexPrefixRulesOptions,
  type CopyCodexPrefixRulesResult,
} from './codex/rules.js';

export {
  copyCodexSkills,
  METALMIND_CODEX_SKILLS,
  removeCodexSkills,
  type CopyCodexSkillsOptions,
  type CopyCodexSkillsResult,
  type MetalmindCodexSkill,
} from './codex/skills.js';

export {
  addCodexMcpServer,
  DEFAULT_CODEX_MCP_NAME,
  DEFAULT_METALMIND_HTTP_URL,
  removeCodexMcpServer,
  type AddCodexMcpServerOptions,
  type AddCodexMcpServerResult,
  type RemoveCodexMcpServerOptions,
  type RemoveCodexMcpServerResult,
} from './codex/mcp.js';

export {
  installCodex,
  uninstallCodex,
  type InstallCodexOptions,
  type InstallCodexResult,
  type UninstallCodexOptions,
  type UninstallCodexResult,
} from './codex/orchestrator.js';
