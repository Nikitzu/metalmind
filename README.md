# metalmind

[![npm version](https://img.shields.io/npm/v/metalmind.svg?color=%23d4a14a&label=npm)](https://www.npmjs.com/package/metalmind)
[![license](https://img.shields.io/npm/l/metalmind.svg?color=%23d4a14a)](LICENSE)

**A metalmind for Claude. Store decisions in copper. Tap them when you need them. Claude never meets you cold again.**

Every `claude` invocation is a first meeting. Yesterday's architectural call, the reason you rejected that library, the 40-minute debug you just finished — gone by tomorrow. metalmind is the place Claude stores things, and the way Claude gets them back — without burning context tokens on tool schemas to do it.

Website: **[metalmind.mzyx.dev](https://metalmind.mzyx.dev)**

---

## What it adds

- **Persistent memory across sessions.** `metalmind store copper "<insight>"` (alias: `save`) deposits a decision into your local Obsidian vault. metalmind proposes the path, wikilinks, and frontmatter; you approve; it writes. Tomorrow's session recalls it as if yesterday never ended.

- **Recall without the MCP token tax.** `metalmind tap copper "<query>"` (alias: `recall`) is a Bash call, not an MCP tool. Zero schema bloat per session — most memory tools silently inject a handful of tool schemas — often heavily over-specified — into every Claude Code session before you've typed a prompt (measured: [`bench/mcp-tax-v0/`](bench/mcp-tax-v0/)). We stamp the command into your `CLAUDE.md` so Claude reaches for it naturally. `--deep` escalates with backlink-walks; `--expand` returns hits plus the surrounding graph; `--list-recent N` browses the N most-recently-modified notes without a query. A co-hosted loopback HTTP server (`127.0.0.1:17317`) inside the watcher process handles recall calls sub-100ms, with stdio MCP as the always-available fallback.
  <br><sub>**Measured** on the 12-note fake vault in [`bench/recall-v0/`](bench/recall-v0/): **hit@5 = 90%**, **hit@3 = 85%**, **hit@1 = 70%**, latency **median 45 ms / p95 87 ms**. Hit payloads are billed like any other bash output; the MCP tax we avoid is the standing tool-schema cost, not the result tokens.</sub>

- **Session-start awareness without nagging.** metalmind installs a Claude Code SessionStart hook plus a top-of-file block in `~/.claude/CLAUDE.md` with explicit WHEN→DO triggers, so every new Claude session discovers the vault on its own — no "did you check memory?" prompting. Re-stamp anytime with `metalmind burn brass` (alias: `stamp`) after an upgrade.

- **Sight across repos, not just one.** `metalmind burn bronze "<query>"` (alias: `graph`) queries a code graph of every repo in your *forge*. HTTP-route-match edges connect caller → handler *across services* in three tiers: OpenAPI specs on the metalmind shelf (never inside your repos), Java RestTemplate/WebClient/Feign callers, and URL literals as an opt-in fallback. Every inferred edge carries `INFERRED_NAME` / `INFERRED_ROUTE` / `INFERRED_URL_LITERAL` provenance so Claude can trust-grade what it reads.

- **Symbol-aware navigation and rename.** `metalmind burn iron <symbol>` (alias: `symbol`) returns a symbol's neighbors — who calls it, what it calls, its module. `metalmind burn steel <old> <new>` (alias: `rename`) drives a coordinated rename through Serena's LSP backend. One verb per concern.

- **Team-debug, dispatched.** `metalmind burn zinc "<bug>"` (alias: `debug`) hands a bug to the `/team-debug` skill with the code graph already primed — the team agents start with context, not cold.

- **Vault writes without drift.** `metalmind scribe <create|update|patch|delete|archive|list|show|rename>` (alias: `note`) is the CRUD interface agents use *instead of* raw `Write`. It stamps frontmatter, picks the right folder (`Plans/Learnings/Work/Daily/Inbox/MOCs/Archive`), auto-links the project MOC, and on `rename` rewrites `[[wikilinks]]` across the vault. Body on stdin; every verb supports `--dry-run`.

- **Reversible to zero.** `metalmind uninstall` stops containers, unloads the watcher service, restores your prior output style, clears the settings we changed, and removes shell aliases. **It never touches your notes.**

## Why it isn't an MCP server

Most memory tools register themselves as MCP servers. That design injects a handful of tool schemas (`search_memory`, `recall`, `store`, …) into **every** Claude session before you prompt anything. Those schemas eat context tokens you could be using for the actual task.

metalmind takes the opposite bet: the recall surface is a CLI, Claude learns the command once from your stamped `CLAUDE.md`, and every session starts with a clean context. The watcher, indexer, and embedding stack still live locally — they just don't live in Claude's tool registry.

**Measured** in [`bench/mcp-tax-v0/`](bench/mcp-tax-v0/) — first-turn token tax on a cold session:

| System | Transport | Tools | First-turn tokens |
|---|---|---:|---:|
| **metalmind** (default) | loopback HTTP | 0 | ~519 *(one-time CLAUDE.md instruction block)* |
| Claude Code native `/memory` | CLAUDE.md text | 0 | ~1 |
| metalmind (stdio MCP fallback) | MCP stdio | 3 | ~157 |
| mem0 (`pinkpixel-dev/mem0-mcp`) | MCP stdio | 3 | ~1,319 |

**~2.5× lower than mem0 as shipped** (loopback-HTTP vs stdio MCP), **~8.4× lower on the apples-to-apples MCP comparison** (metalmind's stdio fallback vs mem0 — same transport, different schema discipline). The ~519 tokens metalmind spends up front are prose in `~/.claude/CLAUDE.md` that teaches Claude *when* to recall — work that mem0's schema-tax doesn't do. Approximation via `chars / 4`; re-run with `ANTHROPIC_API_KEY=... pnpm bench:mcp-tax` for exact counts. `bench/mcp-tax-v0/README.md` details methodology and limits.

## Who should NOT use metalmind

Honest anti-personas — install the wrong tool and you'll bounce in an hour:

- **You don't use Claude Code.** SessionStart hook, stamped `CLAUDE.md`, MCP fallback — all target Claude Code specifically. Cursor/Codex/Copilot/Gemini are roadmap, not shipped.
- **You don't use Obsidian.** The vault is the storage layer. No other UI is planned.
- **You don't want Docker running.** Qdrant + Ollama embed-stack is local but containerized. `sqlite-vec` backend is on the roadmap (removes Docker).
- **You want a 2-minute install.** The wizard takes ~15 minutes the first time — prereqs, embed-model download, first-index. Worth it for daily users; overkill if you're evaluating.
- **You're a team of 5+ with shared memory needs.** metalmind is single-dev by design. The *forge* supports many repos per dev; it does not sync vaults between devs.

## Will this still be around?

Fair question for any solo-maintainer tool. The sustainability story:

- **Your notes outlive metalmind.** The vault is plain markdown in your own `~/Knowledge/` directory. If this project goes unmaintained tomorrow, you keep everything — Obsidian still opens the files, `grep` still searches them, `git` still versions them. metalmind is the layer that makes Claude use them well, not the layer that holds them hostage.
- **No cloud, no accounts, no phone-home.** Embeddings, indexing, recall, code graphs — all local. There is no metalmind backend to shut down, no API quota to throttle, no subscription to lapse. The only network call is the one you were already making to Claude.
- **Reversible in one command.** `metalmind uninstall` stops the watcher, removes Docker containers, strips the sentinel-bounded blocks from your `CLAUDE.md` files (user content outside markers is preserved), and clears shell aliases. Your vault is never touched. Try it — then reinstall if you like it.
- **MIT licensed.** Fork it, vendor it, swap the embedding backend. The architecture decisions are documented (`docs/`, `bench/`, `CHANGELOG.md`) specifically so a contributor — or a future-you — can keep it running.

## Install

**Via npm (recommended):**

```bash
npm install -g metalmind
metalmind init
```

Published at [npmjs.com/package/metalmind](https://www.npmjs.com/package/metalmind) · current release `v0.2.2`.

**From source (for hacking on metalmind itself):**

```bash
git clone https://github.com/Nikitzu/metalmind.git
cd metalmind/cli
pnpm install && pnpm build && pnpm link --global
metalmind init
```

The wizard walks six steps: prereq check, vault scaffold, Python engines via `uv tool install`, Docker stack, watcher service (launchd on macOS, systemd on Linux), MCP registration, optional memory routing. See the [install-flow diagram](https://metalmind.mzyx.dev/#demo) for what each step does.

## Requirements

**Today, metalmind only supports [Claude Code](https://claude.ai/code).** The session-start hook, stamped `CLAUDE.md`, and MCP fallback all target Claude Code specifically. Support for other agents (Cursor, Codex, Copilot, Gemini CLI) is on the roadmap but not shipped yet.

- macOS or Linux (WSL2 works; native Windows not supported)
- [Claude Code CLI](https://claude.ai/code) v2.1+
- [Docker](https://www.docker.com) running
- Python 3.11+, [uv](https://docs.astral.sh/uv/), git, Node 20+

Run `metalmind pulse` (alias: `doctor`) any time to check environment + install state.

## Commands

Every themed (Scadrial) verb has a classic alias. Both always resolve — theming is cosmetic.

| Scadrial | Classic | What it does |
|---|---|---|
| `metalmind init` | `metalmind init` | Interactive setup wizard |
| `metalmind pulse` | `metalmind doctor` | Verify install state |
| `metalmind store copper <insight>` | `metalmind save <insight>` | Deposit a decision into the vault |
| `metalmind tap copper "<query>"` | `metalmind recall "<query>"` | Recall — add `--deep` or `--expand` for more depth |
| `metalmind burn bronze "<query>"` | `metalmind graph "<query>"` | Code-graph query |
| `metalmind burn iron <symbol>` | `metalmind symbol <symbol>` | Pull a symbol + neighbors |
| `metalmind burn steel <old> <new>` | `metalmind rename <old> <new>` | Coordinated rename |
| `metalmind burn zinc "<bug>"` | `metalmind debug "<bug>"` | Dispatch `/team-debug` |
| `metalmind burn pewter` | `metalmind reindex` | Rebuild code graph |
| `metalmind forge <…>` | `metalmind group <…>` | Cross-repo graph groups; `forge capture-spec` seeds OpenAPI shelf |
| `metalmind scribe <verb>` | `metalmind note <verb>` | Vault CRUD: `create \| update \| patch \| delete \| archive \| rename \| list \| show` |
| `metalmind release-check` | `metalmind release-check` | Preflight — working tree, branch, version sync, tests, build, stamped-block present |
| `metalmind burn brass` | `metalmind stamp` | Re-imprint metalmind managed files (upgrade in place) |
| `metalmind burn aluminum` | `metalmind wipe` | Uninstall alias |

Pick a flavor during `init` — it only changes which variant your stamped `CLAUDE.md` recommends to Claude. The CLI always accepts both.

## Under the metalmind

One verb, one job. Each engine is swappable:

| Concern | Engine |
|---|---|
| Semantic recall | [Ollama](https://ollama.com) + [Qdrant](https://qdrant.tech), `nomic-embed-text`, all local |
| Vault | [Obsidian](https://obsidian.md) at `~/Knowledge/` |
| Symbol navigation + rename | [Serena](https://github.com/oraios/serena) (LSP-backed) |
| Code graph + cross-repo edges | [graphify](https://pypi.org/project/graphifyy/) |
| Incremental indexing | [watchfiles](https://github.com/samuelcolvin/watchfiles) + launchd / systemd |
| Forge (cross-repo merge) | metalmind itself — HTTP-route match + name-match edges with provenance |

Your notes, embeddings, and code graphs never leave your machine. The only network calls metalmind makes are the ones you already make to Claude Code's own API.

## Uninstall

```bash
metalmind uninstall
```

Stops and removes the Docker containers, unloads the watcher service, strips the metalmind managed blocks from `~/.claude/CLAUDE.md` and `<vault>/CLAUDE.md` (user content outside the sentinel markers is preserved), removes the SessionStart hook + its entry in `~/.claude/settings.json` (other hooks stay), strips MCP entries, clears `CLAUDE_CODE_DISABLE_AUTO_MEMORY` from settings, restores your prior output-style, and removes shell aliases. Four interactive prompts ask whether to also `uv tool uninstall` Serena, graphify, `metalmind-vault-rag`, and whether to remove Docker volumes (keep them if you don't want to re-embed the vault).

**Never touches your notes.**

## Docs

- [`CHANGELOG.md`](CHANGELOG.md) — release notes, one entry per tag
- [`docs/prerequisites.md`](docs/prerequisites.md) — what to install before `metalmind init`
- [`docs/post-install.md`](docs/post-install.md) — verification + troubleshooting
- [`docs/customization.md`](docs/customization.md) — swapping embedding model, relocating vault, etc.
- [`docs/plugins.md`](docs/plugins.md) — recommended Claude Code plugins
- [`docs/teams.md`](docs/teams.md) — the experimental agent-teams feature
- [`bench/recall-v0/`](bench/recall-v0/) · [`bench/mcp-tax-v0/`](bench/mcp-tax-v0/) — reproducible benches (recall quality + MCP token tax)

## Hacking on the CLI

Dev setup lives in [`cli/README.md`](cli/README.md).

## License

MIT — see [`LICENSE`](LICENSE). Inspired by Brandon Sanderson's Mistborn Era 1 novels. Not affiliated.
