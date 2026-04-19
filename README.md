# metalmind

Unified CLI for a token-efficient, privacy-first Claude Code setup.

Vault capture and semantic recall via Obsidian + local Ollama + Qdrant. Code navigation via Serena LSP. Code graph and cross-repo queries via graphify (coming in v0.2). All local — no code leaves your machine except your existing Claude Code → Anthropic API calls.

## Install

```bash
npm install -g metalmind
metalmind init
```

Works with `npm`, `pnpm`, `yarn`, or `bun` for the global install. The interactive wizard handles everything: vault path, Docker stack start, MCP registration, launchd watcher, rules/agents/commands, shell aliases.

## Requirements

- macOS (Linux support deferred to v2 — launchd is macOS-specific)
- [Claude Code CLI](https://claude.ai/code) v2.1+
- [Docker Desktop](https://www.docker.com/products/docker-desktop) running
- Python 3.10+, [uv](https://docs.astral.sh/uv/), git

Run `metalmind doctor` any time to check the environment.

## What you get

- **Obsidian vault** at `~/Knowledge/` (configurable) with folder scaffolding and CLAUDE.md
- **Local semantic search** — Ollama + Qdrant in Docker, nomic-embed-text model
- **Auto-reindex** — launchd watcher rebuilds the index on vault changes
- **MCP servers** exposed to Claude Code: `search_vault`, `related_notes`, `expand_search`, plus Serena symbol navigation
- **`/save` slash command** — write decisions to the vault with proposed wikilinks
- **15 custom agents** (code-reviewer, security-reviewer, architect, adversary, ...) + rules pack
- **Shell aliases** (`vault-up`, `vault-doctor`, `vault-index`, ...) sourced from `~/.metalmind/aliases.sh`

## Commands

| Themed (default Scadrial flavor) | Classic alias |
|---|---|
| `metalmind init` | `metalmind init` |
| `metalmind doctor` | `metalmind doctor` |
| `metalmind uninstall` | `metalmind uninstall` |

Scadrial / Classic dual-alias verb map for runtime commands (`store copper` / `save`, `tap copper` / `recall`, `burn bronze` / `graph`, ...) lands in v0.2.

## Uninstall

```bash
metalmind uninstall
```

Stops services, removes MCP entries, deletes the Docker stack copy in your vault, removes shell aliases. **Does not touch your notes.**

## License

MIT — see [`LICENSE`](LICENSE).

Built on top of [Obsidian](https://obsidian.md), [Ollama](https://ollama.com), [Qdrant](https://qdrant.tech), [Serena](https://github.com/oraios/serena), [FastMCP](https://github.com/jlowin/fastmcp), [watchfiles](https://github.com/samuelcolvin/watchfiles). Inspired by Brandon Sanderson's Mistborn Era 1 novels. Not affiliated.
