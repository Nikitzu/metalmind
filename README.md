# claude-knowledge-stack

A token-efficient, privacy-first Claude Code setup: Obsidian vault with local semantic search, Serena for code navigation, and a curated agent/rules pack.

Everything runs locally. No code leaves your machine. No third-party analytics.

## What you get

- **Obsidian vault** at `~/Knowledge/` (path configurable) — personal knowledge base
- **Local semantic search** via Ollama + Qdrant in Docker (~300 MB idle RAM)
- **Auto-reindex** on vault changes via launchd + watchfiles
- **MCP tools** exposed to Claude Code: `search_vault`, `related_notes`, `expand_search`
- **`/save` slash command** — write decisions to the vault with proposed wikilinks
- **Serena** code navigation via LSP — 10–30× token reduction on symbol queries
- **15 custom agents** (code-reviewer, security-reviewer, architect, adversary, …)
- **Agent teams** — 4 slash commands (`/team-debug`, `/team-feature`, `/team-pr-review`, `/team-multi-repo-audit`) orchestrating parallel Claude Code sessions that message each other. See [`docs/teams.md`](docs/teams.md).
- **Rule pack** (principles, tool-philosophy, security-boundaries, api-design)
- **Shell aliases** for stack management (`vault-up`, `vault-doctor`, `vault-index`, …)

## Prerequisites

See [`docs/prerequisites.md`](docs/prerequisites.md) for install commands.

- macOS (Linux support untested — launchd is macOS-specific)
- [Obsidian](https://obsidian.md/)
- [Docker Desktop](https://www.docker.com/products/docker-desktop) (running)
- [uv](https://docs.astral.sh/uv/) — Python package manager
- [Claude Code CLI](https://docs.claude.com/en/docs/claude-code) v2.1.32+ installed and authenticated
- `git`, `python3`, `zsh`

## Install

```bash
git clone https://github.com/<you>/claude-knowledge-stack.git
cd claude-knowledge-stack
./install.sh
```

The installer:

1. Verifies prereqs
2. Prompts for vault path (default `~/Knowledge/`)
3. Writes stack files, rules, agents, `/save` command
4. Clones Serena locally for offline-first use
5. Merges `vault-rag` + `serena` into `~/.claude.json` (preserves existing entries)
6. Starts Docker stack, pulls `nomic-embed-text` (~274 MB), builds initial index
7. Loads the macOS launchd watcher for auto-reindex

Idempotent — safe to re-run. Existing files are preserved with a warning.

## Post-install

Restart Claude Code. Open a new shell. Try:

```bash
vault-status        # docker containers running
vault-doctor        # vault hygiene report
```

In Claude Code:

- `/save` — save a decision/learning to the vault
- `search_vault` — semantic search (auto-invoked by Claude)
- `activate_project <repo>` — Serena activates a repo for symbol navigation

See [`docs/post-install.md`](docs/post-install.md) for details.

## Optional: plugin pack

A curated set of official Claude Code plugins:

```bash
./install-plugins.sh
```

Installs: `superpowers`, `context7`, `commit-commands`, `code-review`, `claude-md-management`, `hookify`, `ui-ux-pro-max`.

See [`docs/plugins.md`](docs/plugins.md) for what each does and optional extras.

## Customization

- Add your own rules: drop `*.md` files into `~/.claude/rules/`
- Add your own agents: drop `*.md` files into `~/.claude/agents/`
- Override vault path: set `VAULT_PATH=/path/to/vault` before running `install.sh`

See [`docs/customization.md`](docs/customization.md).

## Uninstall

```bash
./uninstall.sh
```

Stops services, removes stack code and Serena clone, removes MCP entries from `~/.claude.json`. **Does not touch your notes.**

## Privacy

- Vault search is 100% local: Ollama runs the embedding model, Qdrant stores vectors.
- Serena uses LSP (local language servers) — no code leaves your machine. Usage ping is disabled by default.
- Only outbound network call: your existing Claude Code → Anthropic API, same as without this setup.

Audit what gets installed by reading [`install.sh`](install.sh). All source is readable.

## Architecture

```
Your notes (Markdown)
       │
       ▼
  watcher.py (launchd) ──► indexer.py ──► Qdrant (Docker)
                              │
                              ▼
                          Ollama (Docker) ◄── embeddings
                              │
                              ▼
                     MCP: vault-rag server
                              │
                              ▼
                         Claude Code

Your code (repos)
       │
       ▼
   Serena (LSP) ──► MCP: serena ──► Claude Code
```

## License

MIT — see [`LICENSE`](LICENSE).

Built on top of excellent open-source projects:
[Obsidian](https://obsidian.md), [Ollama](https://ollama.com), [Qdrant](https://qdrant.tech),
[Serena](https://github.com/oraios/serena), [FastMCP](https://github.com/jlowin/fastmcp), [watchfiles](https://github.com/samuelcolvin/watchfiles).
