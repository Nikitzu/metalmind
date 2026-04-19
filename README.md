# metalmind

**Unified CLI for a token-efficient, privacy-first Claude Code setup.**

Vault capture and semantic recall via Obsidian + local Ollama + Qdrant. Code navigation via Serena LSP. Code graph and cross-repo queries via [graphify](https://pypi.org/project/graphifyy/). All local — no notes or code leave your machine.

Website: **[metalmind.mzyx.dev](https://metalmind.mzyx.dev)** · Install flow: [metalmind.mzyx.dev/#demo](https://metalmind.mzyx.dev/#demo)

---

## Install

> npm publish is imminent. For now, install from source:

```bash
git clone https://github.com/Nikitzu/metalmind.git
cd metalmind/cli
pnpm install && pnpm build && pnpm link --global
metalmind init
```

Once published:

```bash
npm install -g metalmind
metalmind init
```

The wizard handles: prereq checks, vault scaffold, `uv tool install` of the three Python engines (Serena, graphify, vault-rag), Docker stack startup, watcher service (launchd on macOS, systemd on Linux), MCP registration, optional memory routing, shell aliases. Fully reversible via `metalmind uninstall`.

## Requirements

- **macOS** or **Linux** (WSL2 works; native Windows not supported)
- [Claude Code CLI](https://claude.ai/code) v2.1+
- [Docker](https://www.docker.com) running
- Python 3.10+, [uv](https://docs.astral.sh/uv/), git, Node 20+

Run `metalmind pulse` (or `metalmind doctor`) any time to check environment + install state.

## What you get

- **Obsidian vault** at `~/Knowledge/` (configurable) with folder scaffolding and a stamped `CLAUDE.md`
- **Local semantic recall** — Ollama + Qdrant in Docker, `nomic-embed-text` embeddings. Indexer re-embeds only changed files (no empty-query windows)
- **CLI recall, not MCP** — `metalmind tap copper "<query>"` runs through a CLI call, not an MCP tool. Saves context tokens vs. having the tool schemas injected every session
- **Auto-reindex watcher** — launchd on macOS, systemd `--user` on Linux
- **Serena** (LSP-backed symbol navigation) + **graphify** (per-repo code graph + cross-repo forge)
- **`/save`** slash command — propose note path + wikilinks, approve, write
- **Memory routing** — optionally disable Claude Code's native auto-memory and route everything through the vault (`CLAUDE_CODE_DISABLE_AUTO_MEMORY=1` in `~/.claude/settings.json`)
- **15 custom agents** (code-reviewer, security-reviewer, architect, adversary, …) + a rules pack
- **Shell aliases** (`vault-up`, `vault-doctor`, `vault-index`, …) sourced from `~/.metalmind/aliases.sh`

## Commands

Every themed (Scadrial) verb has a classic alias — both always work:

| Scadrial | Classic | Purpose |
|---|---|---|
| `metalmind init` | `metalmind init` | Interactive setup wizard |
| `metalmind pulse` | `metalmind doctor` | Verify install state |
| `metalmind store copper <insight>` | `metalmind save <insight>` | Deposit into the vault |
| `metalmind tap copper "<query>"` | `metalmind recall "<query>"` | Semantic recall (`--deep`, `--expand` for more) |
| `metalmind burn bronze "<query>"` | `metalmind graph "<query>"` | Code-graph query (graphify) |
| `metalmind burn iron <symbol>` | `metalmind symbol <symbol>` | Pull a symbol + neighbors |
| `metalmind burn steel <old> <new>` | `metalmind rename <old> <new>` | Coordinated rename via Serena |
| `metalmind burn zinc "<bug>"` | `metalmind debug "<bug>"` | Dispatch `/team-debug` |
| `metalmind burn pewter` | `metalmind reindex` | Rebuild code graph |
| `metalmind forge <…>` | `metalmind group <…>` | Cross-repo graph groups |
| `metalmind burn aluminum` | `metalmind wipe` | Uninstall alias |

Pick a flavor during `init` — it only changes which variant the stamped `CLAUDE.md` recommends to Claude. Both CLIs always resolve.

## Uninstall

```bash
metalmind uninstall
```

Stops and removes the Docker containers, unloads the watcher service, strips `serena` from `~/.claude.json`, clears `CLAUDE_CODE_DISABLE_AUTO_MEMORY` from settings, restores your prior output-style, removes shell aliases. **Never touches your notes.**

Python tools (`metalmind-vault-rag`, optionally `serena-agent` and `graphifyy`) can be removed with flags: `metalmind uninstall --remove-serena --remove-graphify --remove-vault-rag`.

## Docs

- [`docs/prerequisites.md`](docs/prerequisites.md) — what to install before `metalmind init`
- [`docs/post-install.md`](docs/post-install.md) — verification + troubleshooting
- [`docs/customization.md`](docs/customization.md) — swapping embedding model, relocating vault, etc.
- [`docs/plugins.md`](docs/plugins.md) — recommended Claude Code plugins
- [`docs/teams.md`](docs/teams.md) — the experimental agent-teams feature

## Hacking on the CLI

Dev setup lives in [`cli/README.md`](cli/README.md).

## License

MIT — see [`LICENSE`](LICENSE).

Built on top of [Obsidian](https://obsidian.md), [Ollama](https://ollama.com), [Qdrant](https://qdrant.tech), [Serena](https://github.com/oraios/serena), [graphify](https://pypi.org/project/graphifyy/), [FastMCP](https://github.com/jlowin/fastmcp), [watchfiles](https://github.com/samuelcolvin/watchfiles). Inspired by Brandon Sanderson's Mistborn Era 1 novels. Not affiliated.
