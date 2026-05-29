# Spec: metalmind → Cursor host port

> Status: draft — awaiting human approval
> Date: 2026-05-16
> Precursor: `docs/specs/2026-05-16-cursor-host-port-design.md` (brainstorm output)

## Objective

Add Cursor as a third install host for metalmind, alongside Claude Code and Codex
CLI. After this work, `metalmind init` / `metalmind stamp --host cursor` installs
metalmind's memory layer into a user's Cursor environment so the Cursor agent
recalls from and writes to the same `~/Knowledge/` vault as the other hosts.

This is the P1 "Cursor host port" roadmap item in the metalmind MOC. Codex shipped
as the second host in v0.8.0; Cursor follows per the multi-host distribution
thesis.

**User:** an existing metalmind user who also codes in Cursor and wants vault
recall + scribe writes available to the Cursor agent.

**Success looks like:** running `metalmind stamp --host cursor` wires Cursor so a
new composer conversation receives the metalmind memory reminder, the agent runs
`metalmind tap copper` before non-trivial work, and `metalmind scribe` is the
vault-write path — with zero manual file editing by the user.

## Tech Stack

- Language: TypeScript (ES modules), Node.
- Repo: pnpm workspace monorepo at `~/Documents/metalmind`. CLI package at `cli/`.
- CLI framework: commander.
- Build: `tsup`. Test: `vitest`. Lint/format: `biome` (root).
- Python recall backend (`packages/vault-rag/`) — unchanged by this work.
- No new runtime dependencies expected.

## Commands

```
Build (cli):      pnpm --filter metalmind build
Build (all):      pnpm build
Dev:              pnpm --filter metalmind dev
Test (cli):       pnpm --filter metalmind test          # vitest run
Test (all):       pnpm test
Test (single):    pnpm --filter metalmind test -- cursor.test.ts
Smoke:            pnpm --filter metalmind test:smoke
Typecheck:        pnpm typecheck
Lint:             pnpm lint                              # biome check
Lint fix:         pnpm lint:fix
```

## Project Structure

```
cli/src/install/codex.ts        → reference implementation (parallel to)
cli/src/install/cursor.ts       → NEW — Cursor install module
cli/src/install/cursor.test.ts  → NEW — unit tests for the above
cli/src/install/dispatch.ts     → MODIFIED — add the cursor host case
cli/src/install/host-prompt.ts  → MODIFIED — add cursor to the multi-select
cli/src/commands/init.ts        → MODIFIED — --host cursor dispatch
cli/src/commands/stamp.ts       → MODIFIED — --host cursor dispatch
cli/src/commands/doctor.ts      → MODIFIED — Cursor health branch
cli/src/commands/uninstall.ts   → MODIFIED — clear Cursor artifacts

cli/templates/.shared/          → canonical prose bodies (skills, memory text)
cli/templates/cursor/           → NEW — Cursor-specific shells:
  hooks/metalmind-cursor-session-start.sh
  skills/<skill>/SKILL.md        (frontmatter shells; bodies from .shared/)
  agents/*.md                    (frontmatter shells; bodies from .shared/)

docs/specs/                     → this spec + the design doc
```

Installed artifacts (all global, under `~/.cursor/`):

| Artifact | Path | Role |
|---|---|---|
| Recall skill | `~/.cursor/skills/metalmind-recall/SKILL.md` | **Backbone.** Auto-discovered; `description` triggers it before non-trivial tasks; body runs `metalmind tap copper`. |
| `sessionStart` hook | `~/.cursor/hooks.json` → `~/.cursor/hooks/metalmind-cursor-session-start.sh` | Installed **latent** — runs fine but `additional_context` injection is a staff-confirmed Cursor bug (3.1.15). Starts working when Cursor ships the fix; no-op until then. |
| Skills | `~/.cursor/skills/<skill>/SKILL.md` | Vault-writing + workflow skills. |
| Subagents | `~/.cursor/agents/*.md` | 15 specialist agents, ported from `cli/templates/claude/agents/`. |
| MCP (opt-in) | `~/.cursor/mcp.json` | HTTP entry to `127.0.0.1`; behind `--with-mcp`. |

**Recall delivery.** The global `sessionStart` hook cannot carry the memory
reminder — `additional_context` injection is broken in Cursor 3.1.15 (staff-
acknowledged 2026-05-03, no fix/ETA), and global `~/.cursor/rules/` is not honored.
The recall instruction therefore ships as the `metalmind-recall` **skill**: Cursor
auto-discovers global skills and keeps each skill's `description` in agent context,
so the agent self-invokes recall when a task is non-trivial. The `sessionStart`
hook is still installed (latent) so recall gains a second, earlier delivery path
automatically once Cursor fixes the bug.

**Legacy-directory note.** Cursor natively reads `~/.claude/skills/`,
`~/.codex/skills/`, `~/.claude/agents/`, and `~/.codex/agents/` as compatibility
directories (`.cursor/` wins on name conflict). A user with the Claude Code host
already installed will see metalmind's skills + agents in Cursor without the Cursor
port. The port still stamps `~/.cursor/` unconditionally — a Cursor-only user has
no `~/.claude/` — accepting harmless duplication for dual-host users.

**Frontmatter forks** (Approach C — bodies shared, frontmatter per-host):
- Cursor `SKILL.md` frontmatter: `name`, `description`, `paths`,
  `disable-model-invocation`, `metadata`. **No `model` field** — the v0.8.7
  `model: sonnet` pin on `writing-vault-notes` does not carry to Cursor; the Cursor
  skill shell omits it.
- Cursor subagent frontmatter: `name`, `description`, `model`, `readonly`,
  `is_background`. Differs from the Claude Code agent shell — fork it.

**Out of scope — no per-project artifacts.** `.cursor/rules/metalmind.mdc` and
`.cursor/commands/` are dropped: global `~/.cursor/rules/` is not honored by
Cursor, and the global `sessionStart` hook already delivers memory instructions to
every project. metalmind installs once, globally, like the Claude Code host.

## Code Style

Match the existing `cli/src/install/codex.ts` module. Named async functions,
explicit return types, marker-based idempotent config merges. Example shape:

```ts
const CURSOR_HOOK_MARKER = "metalmind-cursor-session-start";

export async function applyCursorHooksJson(opts: {
  hookCommand: string;
}): Promise<{ action: "added" | "already-present" | "updated" }> {
  const hooksPath = join(homedir(), ".cursor", "hooks.json");
  const existing = await readJsonOrDefault(hooksPath, { version: 1, hooks: {} });
  // merge a sessionStart entry without clobbering the user's other hooks
  const sessionStart = existing.hooks.sessionStart ?? [];
  if (sessionStart.some((h) => h.command.includes(CURSOR_HOOK_MARKER))) {
    return { action: "already-present" };
  }
  sessionStart.push({ command: opts.hookCommand });
  existing.hooks.sessionStart = sessionStart;
  await writeJson(hooksPath, existing);
  return { action: "added" };
}
```

Host type widens from `'claude' | 'codex'` to `'claude' | 'codex' | 'cursor'` —
let the compiler surface every switch/dispatch site that needs the new case.

## Testing Strategy

- Framework: `vitest`. Tests live beside source as `*.test.ts`.
- **`cli/src/install/cursor.test.ts`** covers:
  - `hooks.json` merge is idempotent and preserves a user's pre-existing hooks.
  - The hook script's emitted JSON uses snake_case `additional_context` — explicit
    regression guard for the Claude Code (`additionalContext`) ↔ Cursor fork.
  - Skill and subagent frontmatter shells are well-formed.
  - `host-prompt` and `dispatchInstall` include the `cursor` case.
- Hook-script test: feed a real `sessionStart` stdin payload, assert valid JSON
  output (or empty output when the recall backend is down).
- `doctor`: a Cursor-branch test (hook registered, skills present).
- Regression: the existing Claude Code and Codex install suites must stay green.
- `pnpm typecheck` and `pnpm lint` clean before any commit.

## Boundaries

- **Always:** run `pnpm --filter metalmind test` + `pnpm typecheck` + `pnpm lint`
  before commit; merge config files via markers (never overwrite user content);
  keep the existing Claude Code / Codex suites green; mirror `codex.ts` patterns.
- **Ask first:** adding any runtime dependency; changing the shared host type or
  `dispatch.ts` signature in a way that touches Claude Code / Codex behavior;
  changing the `~/.cursor/` paths chosen here.
- **Never:** commit secrets; overwrite a user's existing `~/.cursor/hooks.json`
  hooks; weaken or disable a lint rule to pass CI; ship without the snake_case
  `additional_context` regression test.

## Success Criteria

1. `metalmind init` and `metalmind stamp` offer Cursor in the host multi-select,
   and `--host cursor` / `--host all` dispatch to it.
2. `metalmind stamp --host cursor` writes a `sessionStart` entry into
   `~/.cursor/hooks.json` + the hook script, copies skills to `~/.cursor/skills/`,
   and copies 15 subagents to `~/.cursor/agents/` — idempotently (re-running is a
   no-op).
3. The `metalmind-recall` skill is auto-discovered in a Cursor composer; its
   `description` is visible to the agent and the agent invokes it (running
   `metalmind tap copper`) on a non-trivial task. The `sessionStart` hook is
   installed and executes without error (latent until the Cursor bug is fixed).
4. `--with-mcp` adds a working `~/.cursor/mcp.json` HTTP entry; without the flag,
   no MCP entry is written.
5. `metalmind doctor` reports Cursor host status; `metalmind uninstall` removes all
   Cursor artifacts and leaves user-authored content intact.
6. `pnpm --filter metalmind test`, `pnpm typecheck`, `pnpm lint` all pass; existing
   Claude Code / Codex tests unaffected.

## Resolved research (was Open Questions)

1. **Skills schema** — resolved. Global `~/.cursor/skills/<name>/SKILL.md`;
   frontmatter `name` / `description` / `paths` / `disable-model-invocation` /
   `metadata`; no `model` field; optional `scripts/` `references/` `assets/` dirs.
2. **Subagent schema** — resolved. Global `~/.cursor/agents/*.md`; frontmatter
   `name` / `description` / `model` / `readonly` / `is_background`.
3. **`sessionStart` `additional_context`** — resolved as a blocker for that path:
   staff-confirmed Cursor 3.1.15 bug (2026-05-03), no fix/ETA. Recall moved to the
   `metalmind-recall` skill; hook installed latent. See "Recall delivery" above.

## Open Questions

1. **Live-shape verification** — Cursor headless mode (`cursor-agent --print
   --output-format json` / `stream-json`) fires only `sessionStart`. Confirm during
   the plan whether headless output lets us assert the recall skill is surfaced to
   the agent, analogous to the Codex plan's `codex debug prompt-input` check. If
   not scriptable, fall back to a documented manual verification step.
2. **`metalmind-recall` skill body** — the `description` wording must reliably
   trigger auto-invocation without firing on trivial turns. Draft + sanity-check
   during implementation; candidate for a `cli/skills-evals/` case.
3. **Windows `sessionStart`** — buggy in other tools; metalmind is macOS-first, so
   documented and out of scope — not a regression to fix.
