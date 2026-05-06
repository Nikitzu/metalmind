# metalmind on Codex CLI

> **Codex CLI integration ships in v0.8.0.** Codex desktop app integration is on the **v1.1** roadmap — not yet shipped.

## What gets installed

`metalmind init --host codex` (or selecting "Codex CLI" in the multi-select prompt) writes seven things into `~/.codex/`:

| File | Purpose |
|---|---|
| `~/.codex/AGENTS.md` (sentinel block) | Static recall-first instructions Codex injects on every turn |
| `~/.codex/hooks.json` (SessionStart entry) | Dynamic injection at session start — same hook shape as Claude Code |
| `~/.codex/hooks/metalmind-session-start.sh` | The hook script (reused verbatim from Claude Code) |
| `~/.codex/config.toml` (`[sandbox_workspace_write] network_access = true`, sentinel block) | Allows the model's shell tool to reach the local watcher at `127.0.0.1:17317` |
| `~/.codex/rules/metalmind.rules` | Pre-approves the `metalmind` command surface so the first recall doesn't ask for permission |
| `~/.codex/skills/writing-vault-notes/` | OFM + scribe conventions skill |
| `~/.codex/skills/synod/` | 7-persona deliberation skill |
| `~/.codex/skills/save/` | The `/save` workflow as a description-triggered skill (CC keeps the slash-command surface) |

All of these are sentinel-bounded or live in their own `metalmind`-named files so `metalmind uninstall --host codex` round-trips cleanly.

## What we don't touch

- **`~/.codex/memories/`** — Codex's native memory layer; orthogonal to metalmind. Use both, or pick one.
- **`~/.codex/rules/default.rules`** — Codex's user-acceptance log. Auto-managed by Codex when you click "Allow + Remember" in the TUI.
- Any other file outside our sentinel-bounded blocks.

## Verifying the install

After `metalmind init` (with `codex` selected), run:

```
codex debug prompt-input "test" | grep "metalmind tap copper"
```

You should see the AGENTS.md block content inside the `<INSTRUCTIONS>` payload Codex injects. If not, run:

```
metalmind doctor --deep
```

The Codex section reports six (or seven with `--with-mcp`) green/red checks: AGENTS.md sentinel, hook script + `hooks.json` registration, `network_access = true`, prefix rules, skills, and (if `--with-mcp`) the MCP entry.

## Opt-in: register a Codex MCP server

By default metalmind does **not** register an MCP server in Codex. The headline path is bare-bash recall (`metalmind tap copper "..."` via the model's shell tool), which keeps the standing token cost at zero — matching the same architecture we ship for Claude Code.

If you want explicit tool-call ergonomics, add `--with-mcp`:

```
metalmind init --host codex --with-mcp
# or, after install:
metalmind stamp --host codex --with-mcp
```

This runs `codex mcp add metalmind --url http://127.0.0.1:17317/mcp`. Trade-offs:

| | Bare bash (default) | `--with-mcp` |
|---|---|---|
| Standing token cost | 0 | ~150–400 tokens (tool schema, every turn) |
| Model UX | Shell tool call | First-class tool call |
| Removal | `metalmind uninstall` | Same; also runs `codex mcp remove metalmind` |
| Matches v0.7.0 site honesty bar (zero MCP-tax) | ✅ | ❌ asterisk |

## Sandbox + first-recall behavior

Codex's default `workspace-write` sandbox blocks loopback network, AND requires per-prefix approval for arbitrary commands. metalmind handles BOTH:

1. **Network**: `metalmind init --host codex` stamps `[sandbox_workspace_write] network_access = true` in `~/.codex/config.toml`. Loopback to `127.0.0.1:17317` is now allowed.
2. **Per-prefix approval**: `metalmind init --host codex` writes `~/.codex/rules/metalmind.rules` with `prefix_rule(["metalmind", "tap"], decision="allow")` (and the same for every other `metalmind` subcommand). The model can run `metalmind tap copper "X"` from turn 1 without an escalation prompt.

If a recall ever fails with a sandbox network denial AFTER install: check `metalmind doctor --deep` for the `codex-network-access` line. If the user has a competing `[sandbox_workspace_write]` table OUTSIDE our sentinel-bounded block with `network_access = false`, **the user's value wins** (TOML semantics). Either move the user value inside the metalmind block or remove the user override.

## Multi-host install

`metalmind init` always shows a multi-select prompt of detected hosts (`~/.claude/`, `~/.codex/`). To skip the prompt:

```
metalmind init --host claude         # Claude Code only
metalmind init --host codex          # Codex CLI only
metalmind init --host both           # both (when both are detected)
metalmind init --host codex --with-mcp   # Codex + opt-in MCP server
```

Re-running `metalmind stamp` re-prompts so newly-installed hosts surface. To skip the re-prompt and reuse the previous selection (CI / scripted re-stamps):

```
metalmind stamp --no-prompt
```

## Codex desktop app — coming in v1.1

The `codex app` desktop client is **NOT** covered by this integration. v1.1 will verify whether the desktop app shares `~/.codex/` storage and whether the model has shell-exec; until then, treat metalmind as Codex CLI–only.

## Uninstall

```
metalmind uninstall
```

Detects all stamped hosts (CC, Codex, both) and strips them. The pre-confirm summary names every Codex artifact that will be removed and lists what is **not** touched (`~/.codex/memories`, `~/.codex/rules/default.rules`).

After uninstall, `grep -r metalmind ~/.codex/` returns empty (excluding `default.rules`, which is Codex-managed).
