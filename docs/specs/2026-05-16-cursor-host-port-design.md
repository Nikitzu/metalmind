# metalmind → Cursor host port — design

> Status: draft (brainstorm output, pre-plan)
> Date: 2026-05-16
> Project: metalmind

## Purpose

Add Cursor as a third install host for metalmind, alongside Claude Code and Codex
CLI. After this work, `metalmind init` / `metalmind stamp --host cursor` installs
metalmind's memory layer into a user's Cursor environment so the Cursor agent
recalls from and writes to the same `~/Knowledge/` vault.

This is the P1 "Cursor host port" roadmap item carried in the metalmind MOC. Codex
shipped as the second host in v0.8.0; Cursor is the next per the multi-host
distribution thesis (`Learnings/multi-host-distribution-thesis-bash-required`).

## Background

Cursor releases 2.4 (January 2026) and 2.5 (February 2026) reshaped its
extensibility surface:

- **Rules** — `.cursor/rules/*.mdc` files, frontmatter `description` / `globs` /
  `alwaysApply`. Project-scoped only. Global `~/.cursor/rules/` is **not** honored
  (open feature request); user-level rules live in the Settings UI and are not a
  stampable file.
- **Hooks** — agent-loop hooks configured in `hooks.json`. Global
  `~/.cursor/hooks.json` applies to all projects; project `.cursor/hooks.json`
  takes precedence on merge. Events include `sessionStart`, `beforeShellExecution`,
  `afterFileEdit`, `stop`, and others.
- **Skills** — `SKILL.md` manifests, a skills marketplace, custom slash commands,
  and per-skill hooks.
- **Subagents** — `.cursor/agents/` (project) and `~/.cursor/agents/` (global),
  Markdown with YAML frontmatter. Async since 2.5.
- **Plugins** — a 2.5 package format bundling skills, hooks, rules, and AGENTS.md
  across the IDE and CLI.
- **MCP** — `.cursor/mcp.json` for MCP server registration.

metalmind's recall model is unchanged by host: the host's agent runs
`metalmind tap copper` as a shell command over loopback HTTP. Cursor's agent
executes terminal commands natively, so the bash thesis holds. Cursor is a valid
host.

## Decisions (from brainstorming)

1. **Distribution: stamp files directly.** `metalmind stamp --host cursor` writes
   Cursor config in place, consistent with the existing Claude Code / Codex
   architecture. Packaging metalmind as a Cursor 2.5 Plugin is deferred to a
   follow-up once that format stabilizes.
2. **Scope: full parity** with the Claude Code / Codex install — memory recall,
   skills, commands, subagents, optional MCP.
3. **Recall trigger: the `sessionStart` hook.** Cursor's `sessionStart` hook fires
   on each new composer conversation and can inject `additional_context` into the
   conversation's initial system context — a near-exact analog of Claude Code's
   SessionStart hook.
4. **Code organization: Approach C — share bodies, fork frontmatter.** Prose
   bodies (skill content, memory instructions) stay single-sourced in
   `cli/templates/.shared/`; host-specific shells (`.mdc` frontmatter, `hooks.json`,
   `agents/` files, `SKILL.md` frontmatter) are authored per-host in a new
   `cli/templates/cursor/` tree. This reuses the `.shared` partial mechanism
   shipped in v0.8.6 for Claude Code ↔ Codex parity.

### Correction during brainstorming

The initial decision was to make `.cursor/rules/metalmind.mdc` the global memory
backbone. Research showed global `~/.cursor/rules/` is not honored. The memory
instructions therefore move into the `sessionStart` hook's `additional_context`
output — the global `~/.cursor/hooks.json` hook becomes the single global backbone
carrying both the recall trigger and the memory prose. `.cursor/rules/metalmind.mdc`
is demoted to an optional, per-project, opt-in artifact for rules-panel visibility.

## Architecture

Global install under `~/.cursor/` (per-user, all projects), matching the Claude
Code model. Project-scoped artifacts are stamped only when `metalmind stamp` runs
inside a repository and the user opts in.

### Components

| Artifact | Path | Scope | Role |
|---|---|---|---|
| Recall hook + memory prose | `~/.cursor/hooks.json` → `metalmind-cursor-session-start.sh` | global | **Backbone.** `sessionStart` hook; emits `additional_context`. |
| Skills | `~/.cursor/skills/<skill>/SKILL.md` | global | Vault-writing + workflow skills; bodies from `.shared/`. |
| Subagents | `~/.cursor/agents/*.md` | global | Specialist agents, if Claude Code parity ships any. |
| Memory rule | `.cursor/rules/metalmind.mdc` | per-project, opt-in | `alwaysApply: true`; rules-panel visibility. |
| Commands | `.cursor/commands/*.md` | per-project | Custom slash commands (e.g. `/save`). |
| MCP (opt-in) | `~/.cursor/mcp.json` | global | HTTP entry to `127.0.0.1`; behind `--with-mcp`. |

### Install code

New `cli/src/install/cursor.ts`, parallel to `cli/src/install/codex.ts`:

- `stampCursorRule` — write the optional per-project `.cursor/rules/metalmind.mdc`.
- `copyCursorHook` + `applyCursorHooksJson` — write the hook script and merge the
  `sessionStart` entry into `~/.cursor/hooks.json`.
- `copyCursorSkills` — copy skill bundles into `~/.cursor/skills/`.
- `copyCursorCommands` — write per-project `.cursor/commands/*.md`.
- `copyCursorAgents` — copy subagents into `~/.cursor/agents/`.
- `addCursorMcpServer` — register the opt-in MCP entry.
- `stampCursorFull` — orchestrator, mirrors `stampCodexFull`.

Cross-cutting changes:

- The host type widens to `'claude' | 'codex' | 'cursor'`.
- The `--host` flag, the install-wizard multi-select prompt, and `dispatchInstall`
  all gain the `cursor` case.
- `metalmind doctor` gains a Cursor branch (hook registration, skills present,
  divergence checks).
- `metalmind uninstall` / `teardown` clear all Cursor artifacts.

### hooks.json contract

Config file format:

```json
{
  "version": 1,
  "hooks": {
    "sessionStart": [
      { "command": "~/.cursor/hooks/metalmind-cursor-session-start.sh" }
    ]
  }
}
```

The hook script receives a `sessionStart` payload on stdin (`conversation_id`,
`model`, `workspace_roots`, `composer_mode`, `is_background_agent`, and others) and
prints:

```json
{ "additional_context": "<metalmind memory reminder>" }
```

Note: Cursor uses snake_case `additional_context`; Claude Code uses
`additionalContext` inside `hookSpecificOutput`. The emit format is forked per
Approach C — script logic is shared, output formatting is host-specific.

## Data flow

**Install** — `metalmind init` / `stamp --host cursor` → `stampCursorFull`:

1. Merge the `sessionStart` entry into `~/.cursor/hooks.json`; write the hook script.
2. Copy skills to `~/.cursor/skills/`, subagents to `~/.cursor/agents/`.
3. If run inside a repo and opted in: stamp `.cursor/rules/metalmind.mdc` and
   `.cursor/commands/*.md`.
4. If `--with-mcp`: add the `~/.cursor/mcp.json` HTTP entry.

**Runtime recall** — the user opens a Cursor composer → `sessionStart` fires →
the hook script emits `{"additional_context": "<memory reminder>"}` → the text is
injected into the conversation's initial system context → the agent runs
`metalmind tap copper` over loopback before non-trivial tasks → vault hits return.

**Write path** — the agent uses the `/save` command or the `writing-vault-notes`
skill → runs `metalmind scribe`.

## Error handling

- **Cursor not installed** — `dispatchInstall` detects absence and skips with a
  warning, mirroring the Codex `codex-not-found` path.
- **Existing `~/.cursor/hooks.json`** — marker-based managed-block merge,
  idempotent. A user's other hooks are never overwritten. The `"version": 1` field
  is honored; a version mismatch produces a warning.
- **metalmind HTTP down at session start** — the hook is fire-and-forget; it emits
  no `additional_context` and the agent proceeds without recall. No block, no error
  surfaced to the user.
- **`stamp` run outside a repo** — project-scoped artifacts (`rules/`, `commands/`)
  are skipped with a notice; global artifacts still install.
- **Uninstall** — removes the managed hook block, skills, and subagents; leaves
  user-authored content untouched.
- **Windows `sessionStart`** — known to be buggy in other tools per research.
  Out of scope; metalmind is macOS-first. Recorded here so the plan does not treat
  it as a regression.

## Testing

- **Unit** (`cli/src/install/cursor.test.ts`): `hooks.json` merge idempotency;
  hook emit shape asserts snake_case `additional_context` (explicit regression
  guard for the Claude Code ↔ Cursor fork); skill frontmatter fork; host-prompt
  and `dispatchInstall` include the `cursor` case.
- **Hook script test**: feed a real `sessionStart` stdin payload, assert valid
  JSON output.
- **`metalmind doctor`**: a Cursor-branch test.
- **Regression**: the existing Claude Code and Codex install suites stay green.
- **Live-shape verification** (research item): confirm the real Cursor hook
  injection against a `cursor-agent` headless run if one exposes session context —
  the equivalent of the Codex plan's `codex debug prompt-input` check.

## Open research items (for the implementation plan)

1. **Exact `~/.cursor/skills/` layout** — confirm the global skills directory path
   and `SKILL.md` frontmatter schema (fields, whether a `model` field exists).
2. **Cursor custom-command format** — confirm `.cursor/commands/*.md` structure
   and whether a global commands directory exists.
3. **Subagent frontmatter schema** — confirm `~/.cursor/agents/*.md` YAML fields;
   decide whether metalmind ships any subagents for Cursor at all (Claude Code
   parity may ship none).
4. **`cursor-agent` headless hook behavior** — whether the CLI exposes a way to
   dump injected session context for the live-shape test.

## Out of scope

- Cursor 2.5 Plugin packaging — deferred follow-up.
- Windows / Linux support for the Cursor host — macOS-first, consistent with the
  rest of metalmind.
- Replacing Cursor's own memory features — orthogonal; the user chooses.

## References

- metalmind MOC — `Work/MOCs/metalmind.md` (vault)
- `Learnings/multi-host-distribution-thesis-bash-required` (vault)
- Codex host integration — `Archive/Plans/2026-05-06-codex-host-integration-impl.md` (vault)
- Cursor docs: rules, hooks, subagents (cursor.com/docs)
