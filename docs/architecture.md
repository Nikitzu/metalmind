# Architecture

metalmind is seven modules sharing four pieces of state. This page is the architectural overview - what each module owns, how they wire together, and why the integration is the moat.

For module-level user docs see the repo root [`README.md`](../README.md). For per-feature reference run `metalmind --help`. For "how to use this well" see [`cookbook.md`](cookbook.md).

## The seven modules

| Module | Verbs | What it owns |
|---|---|---|
| **Memory** | `tap copper` / `store copper` / `scribe` / `gold` | Recall, save, vault CRUD, archive |
| **Vault sync** | `duralumin` / `sync` | Commit and push the vault with note-loss guards |
| **Code intelligence** | `forge` / `burn iron\|steel\|zinc` | Cross-repo graph, rename, debug-team dispatch. Within-repo graph work belongs to [codegraph](https://github.com/colbymchenry/codegraph). |
| **Daily workflow** | `atium` / `routine` | Daily-note action items + EOD launchd routine |
| **Deliberation** | `synod` | 7-persona deliberative council (CLI shells out to `claude -p`) |
| **Desktop integration** | `flare` | macOS banner / dialog / sticky notifications |
| **Health** | `pulse` / `doctor --recall-audit` | Install verification + recall-quality self-audit |

## The four pieces of shared state

Every module reads or writes through these - never bypassing them. The integration discipline is what makes the modules a library and not a toolbox.

### 1. The vault (`~/Knowledge/` by default)

Plain-markdown vault with frontmatter (Obsidian-compatible, not required). Owned by the user, never by metalmind. Folder layout:

```
<vault>/
├── Plans/          # implementation plans, dated filename
├── Work/           # active project notes, decisions, architecture
│   └── MOCs/       # one map-of-content per project
├── Learnings/      # durable cross-session lessons
├── Daily/          # journal entries, YYYY-MM-DD.md
├── Inbox/          # transient triage bucket
├── Memory/         # model-managed context (rare)
├── Personal/       # non-work
├── Archive/        # shipped or superseded
└── CLAUDE.md       # vault-local stamped block (sentinel-bounded)
```

`scribe` is the canonical write surface for non-daily kinds. `atium` is the canonical surface for daily action items. `gold` archives in one shot. None of them ever touches files outside the sentinel-bounded blocks they own.

The folder layout maps onto the episodic/semantic/procedural taxonomy from agent-memory research: `Daily/` and `Inbox/` are episodic (what happened, time-bound, penalised in recall as they age out of relevance), `Work/`/`Learnings/`/`Plans/`/`Memory/` are semantic (what is true, kept honest by supersedes and code refs), and the stamped rules/skills/CLAUDE.md blocks are procedural (how to act, re-stamped on every upgrade).

### 2. Sentinel-bounded stamped blocks

metalmind writes blocks into user-owned files between sentinels:

```
<!-- metalmind:managed:begin -->
...managed content...
<!-- metalmind:managed:end -->
```

Stamped files (per host, only the hosts you chose at `init`):
- `~/.claude/CLAUDE.md` - global rule for every Claude Code session
- `<vault>/CLAUDE.md` - vault-local rules (folders, lookup ladder, daily-date contract)
- `~/.claude/settings.json` - env vars + SessionStart hook entry (sentinel keys, not text)
- `~/.codex/AGENTS.md` + `~/.codex/config.toml` - Codex CLI rules and config (v0.8.0)
- `~/.cursor/skills/`, `~/.cursor/agents/`, `~/.cursor/hooks.json` - Cursor recall skill, subagents, and the latent sessionStart hook (v0.9.0)
- `~/.metalmind/aliases.sh` - shell aliases sourced from `~/.zshrc` / `~/.bashrc`

`metalmind uninstall` strips by sentinel. **User content outside the markers is preserved.** This is the reversibility guarantee - and it's what every module relies on to stay non-invasive.

### 3. The watcher process + recall HTTP fast-path

A single Python process (`metalmind-vault-rag-watcher`) under launchd (macOS) or systemd --user (Linux):

- Watches the vault for file changes via `watchfiles`
- Indexes into sqlite-vec (vectors) + SQLite FTS5 (keyword) - both files at `~/.metalmind/`
- Co-hosts a loopback HTTP server at `127.0.0.1:17317` for sub-100ms recall calls
- Stays in-process - no Docker, no daemon (default since v0.5.0, the only path since v0.16.0)

`tap copper` hits the HTTP endpoint first; falls back to stdio MCP if the watcher is down. Both transports return the same JSON shape - pinned by `recall.test.ts`.

### 4. The CLI surface (Node + commander)

The Node CLI is the only public entry point. It's the package on npm, the binary on PATH, the thing every module ships through. `cli/src/commands/` is verb implementations; `cli/src/install/` is per-concern installers; `cli/src/scribe/` and `cli/src/forge/` are domain logic.

The Node ↔ Python boundary is **loopback HTTP only** - never imports. Protocol changes ship coordinated releases of both packages (`metalmind` on npm + `metalmind-vault-rag` on the bundled `uv tool` venv).

## How the modules share state

```
                    ┌──────────────────────────────────┐
                    │  user's vault (~/Knowledge/)     │
                    │  plain markdown, frontmatter     │
                    └─────┬────────────────────────────┘
                          │ reads / writes
                          ▼
   ┌─────────────────────────────────────────────────────┐
   │            sentinel-bounded stamps                  │
   │  ~/.claude/CLAUDE.md  · <vault>/CLAUDE.md ·         │
   │  ~/.claude/settings.json · ~/.metalmind/aliases.sh  │
   └────────────────────┬────────────────────────────────┘
                        │ teaches the host:
                        │   "use metalmind tap copper"
                        ▼
   ┌────────────────────────────────────────┐         ┌──────────────────────┐
   │  host session (Claude Code /           │  Bash   │  metalmind CLI       │
   │  Codex CLI / Cursor)                   ├────────►│  (Node, commander)   │
   └────────────────────────────────────────┘         │                      │
                                                      │  • tap copper        │
                                                      │  • store copper      │
                                                      │  • scribe ...        │
                                                      │  • forge ...         │
                                                      │  • atium ...         │
                                                      │  • synod ...         │
                                                      │  • flare ...         │
                                                      │  • pulse / doctor    │
                                                      └────┬────────┬────────┘
                                                           │        │
                                            loopback HTTP  │        │ stdio fallback
                                            127.0.0.1:17317│        │ (when watcher down)
                                                           ▼        ▼
                                                   ┌─────────────────────────┐
                                                   │  watcher process        │
                                                   │  metalmind-vault-rag    │
                                                   │  (Python, uv-installed) │
                                                   │                         │
                                                   │  • watchfiles indexer   │
                                                   │  • sqlite-vec store     │
                                                   │  • FTS5 keyword         │
                                                   │  • fastembed (ONNX)     │
                                                   │  • optional rerank      │
                                                   └─────────────────────────┘
```

## Module-by-module: what's actually under each verb

### Memory

- `tap copper` (recall) - RRF-fused semantic + BM25 hybrid retrieval, top-rank bonus, weighted lists, optional cross-encoder rerank. Fusion weights are adaptive: queries carrying exact-match tokens (UUIDs, numeric IDs, ticket IDs, hostnames, emails) raise the keyword-leg weight (disable with `METALMIND_RRF_ADAPTIVE=0`). Fused scores are folder-weighted: `Archive/` hits at 0.4x, `Inbox/` at 0.7x, so archived and unsorted notes re-rank below in-flight work without being excluded; notes marked `status: superseded` get the same treatment (0.4x, `METALMIND_SUPERSEDE_PENALTY`) and their hits carry `superseded_by` pointing at the successor. `--verify-code` (opt-in, HTTP path) validates `code: ["repo#symbol"]` frontmatter refs against forge-registered repos via rg/grep and flags hits whose code is gone; `doctor` runs the same validation vault-wide as `code-refs-integrity`. Returns hits as JSONL. `--compact` renders a lean per-hit form; `--semantic-only` / `--keyword-only` isolate one retriever leg for A/B (HTTP path only); `--list-recent N` browses without a query.
- `store copper` (save) - proposes path + frontmatter + wikilinks, agent confirms, writes through `scribe create` (or `scribe update` if recall surfaced an existing note).
- `ingest auto-memory` - imports `~/.claude/projects/*/memory/*.md` topic files as `Memory/auto-<project>-<topic>.md` with `source_path` + `imported_hash` provenance; re-runs skip unchanged sources, follow changed ones, and refuse to clobber locally-edited copies.
- `scribe <create|update|patch|supersede|delete|archive|list|show|rename>` - vault CRUD. Stamps frontmatter, picks intent folder, auto-links the project MOC, rewrites `[[wikilinks]]` on rename. Daily-targeted writes for non-today dates require `--date` to acknowledge.
- `gold <kind:slug>` - one-shot archive (move to `Archive/`, set `status: archived`).

### Vault sync

- `duralumin` (sync) - a single command that pulls with rebase, stages, runs three note-loss guards over the change set (unexplained-deletion, delete-only, incomplete-staging), commits, pushes, and verifies the remote advanced. Guards live in the CLI, never in prompt text. `--dry-run` reports without committing.

### Code intelligence

- `forge` - manage forge groups (named sets of repo paths) and the OpenAPI spec shelf (`~/.metalmind/specs/`).
- The cross-repo graph is built from your source on demand. HTTP-route edges connect caller in repo A to handler in repo B, in three tiers: (1) shelf OpenAPI specs, (2) Java framework callers (RestTemplate / WebClient / Feign), (3) URL string literals (opt-in). Symbol-name edges connect a type or function declared in two different repos. Every inferred edge carries provenance.
- `burn iron` (symbol) - where a symbol is declared, in the current repo or across a forge. Runs on metalmind's own symbol extractor; no index, no external tool.
- `burn steel` (rename) - coordinated symbol rename through Serena.
- `burn zinc` (debug) - dispatch `/team-debug` skill.

Within a single repo, metalmind defers to [codegraph](https://github.com/colbymchenry/codegraph), which is local, MIT-licensed, and ships its own MCP server. metalmind does not depend on it or subprocess it - the two are installed side by side. The retired `burn bronze` / `burn pewter` commands print the codegraph equivalent and exit non-zero.

### Daily workflow

- `atium new --date <date>` - seed a daily note for `today | tomorrow | next-workday | YYYY-MM-DD`. `--from <prev>` carries unchecked items forward.
- `atium add "<item>" --date <date>` - append a checkbox bullet under `## Action Items`.
- `routine install eod` - register a launchd Mon-Fri 17:30 carry-and-archive routine. `routine remove eod` reverses it.

### Deliberation

- `synod "<question>"` - shells out to `claude -p` with the `synod` skill prompt. The skill spawns 7 personas as parallel subagents (Adversary / Strategist / Scientist / Visionary / Engineer / Philosopher / Humanist - or Kelsier's crew under Scadrial flavor), debates, and synthesises a structured verdict. The CLI shell-out keeps the deliberation inside a real Claude Code session so subagent orchestration works.

### Desktop integration (macOS)

- `flare banner|dialog|sticky <title> <message>` - wraps `osascript` / `terminal-notifier` so other modules (notably the EOD routine and `/save`) can surface notifications without each module owning a notification primitive.

### Health

- `pulse` (doctor) - install verification: prereqs, config, MCP state, sentinel presence, watcher liveness. `--deep` adds live-service probes; `--recall-audit` replays the opt-in NDJSON recall log and surfaces zero-hit / weak-hit queries as `/save` candidates.
- `doctor --deep` also runs `intent-skills`: for each forge-registered repo it resolves that repo's own `node_modules/.bin/intent` and asks `list --json` how many TanStack Intent skills its dependencies expose. Informational only - it never fails, copies nothing into the vault, and installs nothing (a repo without Intent has no binary, so nothing is spawned).

## The four-rule honesty bar

Every module clears all four. If a proposed module fails any one, it doesn't ship.

1. **Zero standing MCP-schema tax in Claude Code.** No tool schema injected into every session. Recall is a Bash call to a CLI. The stdio MCP fallback is opt-in and only active when the watcher's HTTP server is down.
2. **Reversible to zero.** `metalmind uninstall` strips every sentinel, unloads the watcher, removes the alias file, restores prior output style. **Never touches the vault.**
3. **No accounts, no cloud, no third-party services.** Embeddings, indexing, recall, code graphs - all local. The only network calls metalmind makes are the ones you were already making to Claude Code's own API.
4. **Closes a gap Claude Code itself doesn't fill.** No duplication of host primitives. The bar refuses, by construction, anything that would make metalmind a chat assistant, a cloud-sync product, or a hosted memory service.

## Adding a new module

1. The module must clear all four rules above.
2. It must share state through one of the four shared pieces (vault / sentinels / watcher / CLI). New shared state is a major design conversation, not a feature.
3. It must have a single CLI verb (themed name + classic alias) - no module is allowed to grow more than ~5 verbs.
4. It must be reversible - every install path needs a teardown counterpart.
5. It must have an installer in `cli/src/install/<thing>.ts` with a mirrored `*.test.ts`.

If a candidate passes those, it's a module. If not, it's a feature inside an existing module - or it's not metalmind's problem.

## See also

- [`cookbook.md`](cookbook.md) - opinionated patterns for using each module well.
- [`prerequisites.md`](prerequisites.md) - what to install before `metalmind init`.
- [`post-install.md`](post-install.md) - verification + troubleshooting.
- [`customization.md`](customization.md) - embedding model swaps, vault relocation.
- [`teams.md`](teams.md) - the experimental agent-teams feature.
- Repo root [`README.md`](../README.md) - the user-facing entry point + comparison matrix.
