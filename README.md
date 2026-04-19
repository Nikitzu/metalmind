# metalmind

**A metalmind for Claude. Store decisions in copper. Tap them when you need them. Claude never meets you cold again.**

Every `claude` invocation is a first meeting. Yesterday's architectural call, the reason you rejected that library, the 40-minute debug you just finished — gone by tomorrow. metalmind is the place Claude stores things, and the way Claude gets them back — without burning context tokens on tool schemas to do it.

Website: **[metalmind.mzyx.dev](https://metalmind.mzyx.dev)**

---

## What it adds

- **Persistent memory across sessions.** `metalmind store copper "<insight>"` (alias: `save`) deposits a decision into your local Obsidian vault. metalmind proposes the path, wikilinks, and frontmatter; you approve; it writes. Tomorrow's session recalls it as if yesterday never ended.

- **Recall without the MCP token tax.** `metalmind tap copper "<query>"` (alias: `recall`) is a Bash call, not an MCP tool. Zero schema bloat per session — most memory tools silently inject 3-5 tool schemas into every Claude Code session before you've typed a prompt. We stamp the command into your `CLAUDE.md` so Claude reaches for it naturally. `--deep` escalates with backlink-walks; `--expand` returns hits plus the surrounding graph.

- **Sight across repos, not just one.** `metalmind burn bronze "<query>"` (alias: `graph`) queries a code graph of every repo in your *forge*. HTTP-route-match edges connect caller → handler *across services*. Every inferred edge carries `INFERRED_NAME` / `INFERRED_ROUTE` provenance so Claude can trust-grade what it reads.

- **Reversible to zero.** `metalmind uninstall` stops containers, unloads the watcher service, restores your prior output style, clears the settings we changed, and removes shell aliases. **It never touches your notes.**

## Why it isn't an MCP server

Most memory tools register themselves as MCP servers. That design injects a handful of tool schemas (`search_memory`, `recall`, `store`, …) into **every** Claude session before you prompt anything. Those schemas eat context tokens you could be using for the actual task.

metalmind takes the opposite bet: the recall surface is a CLI, Claude learns the command once from your stamped `CLAUDE.md`, and every session starts with a clean context. The watcher, indexer, and embedding stack still live locally — they just don't live in Claude's tool registry.

## Install

**Today — from source:**

```bash
git clone https://github.com/Nikitzu/metalmind.git
cd metalmind/cli
pnpm install && pnpm build && pnpm link --global
metalmind init
```

**Soon — via npm:**

```bash
npm install -g metalmind
metalmind init
```

The wizard walks six steps: prereq check, vault scaffold, Python engines via `uv tool install`, Docker stack, watcher service (launchd on macOS, systemd on Linux), MCP registration, optional memory routing. See the [install-flow diagram](https://metalmind.mzyx.dev/#demo) for what each step does.

## Requirements

- macOS or Linux (WSL2 works; native Windows not supported)
- [Claude Code CLI](https://claude.ai/code) v2.1+
- [Docker](https://www.docker.com) running
- Python 3.10+, [uv](https://docs.astral.sh/uv/), git, Node 20+

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
| `metalmind forge <…>` | `metalmind group <…>` | Cross-repo graph groups |
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

Stops and removes the Docker containers, unloads the watcher service, strips MCP entries, clears `CLAUDE_CODE_DISABLE_AUTO_MEMORY` from settings, restores your prior output-style, removes shell aliases. Python tools stay unless you pass `--remove-serena --remove-graphify --remove-vault-rag`.

**Never touches your notes.**

## Docs

- [`docs/prerequisites.md`](docs/prerequisites.md) — what to install before `metalmind init`
- [`docs/post-install.md`](docs/post-install.md) — verification + troubleshooting
- [`docs/customization.md`](docs/customization.md) — swapping embedding model, relocating vault, etc.
- [`docs/plugins.md`](docs/plugins.md) — recommended Claude Code plugins
- [`docs/teams.md`](docs/teams.md) — the experimental agent-teams feature

## Hacking on the CLI

Dev setup lives in [`cli/README.md`](cli/README.md).

## License

MIT — see [`LICENSE`](LICENSE). Inspired by Brandon Sanderson's Mistborn Era 1 novels. Not affiliated.
