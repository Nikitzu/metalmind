# Post-install

## First things first

1. **Restart Claude Code** — so it picks up the new MCP servers (`vault-rag`, `serena`).
2. **Open a new terminal** (or `exec zsh`) — so shell aliases load.

## Verify

In a new shell:

```bash
vault-status        # should show knowledge-ollama + knowledge-qdrant running
vault-doctor        # vault hygiene report (duplicates, orphans, dead links, stale inbox)
```

In Claude Code, ask something conceptual — Claude should call `search_vault`. If you just installed, the vault is empty, so results will be sparse. Save a first note:

```
/save
```

Then paste a decision or insight. Claude proposes a filename, folder, and wikilinks; you approve; it writes to the vault. The watcher auto-reindexes within ~3 seconds.

## Shell aliases

Sourced from `~/.claude-knowledge-stack/aliases.sh` via `~/.zshrc`.

| Alias | What it does |
|---|---|
| `vault-up` | Start Docker stack |
| `vault-down` | Stop Docker stack |
| `vault-status` | Show container status |
| `vault-logs` | Tail container logs |
| `vault-index` | Rebuild full index from scratch |
| `vault-doctor` | Vault hygiene: duplicates, orphans, dead links, stale inbox |
| `vault-watcher-start` / `vault-watcher-stop` | Load/unload the launchd watcher |

## Serena: activating repos

The installer registers nothing by default. In Claude Code:

```
activate_project /path/to/your/repo
```

Serena auto-detects the primary language (TS, Python, Java, Go, Rust, …) and spins up the language server. First activation for a new language downloads the LSP binary (~100–200 MB). Cached after that.

Project configs live in `~/.serena/projects-data/<name>/` — outside your repos, so nothing to `.gitignore` per-repo.

## Recommended plugin pack

```bash
./install-plugins.sh
```

Installs superpowers, context7, commit-commands, code-review, claude-md-management, hookify, ui-ux-pro-max. See [`plugins.md`](plugins.md).

## Troubleshooting

**Claude Code doesn't see `search_vault`**
Restart Claude Code. Verify `~/.claude.json` has an `mcpServers.vault-rag` entry. Run `vault-status` — containers must be up. Try `vault-logs` to see what Ollama and Qdrant are doing.

**Watcher not auto-reindexing**
```bash
launchctl list | grep vault-indexer
tail -f ~/Knowledge/.claude-stack/watcher.err
```
If the log shows `ModuleNotFoundError`, re-run `cd ~/Knowledge/.claude-stack/vault_rag && uv sync`.

**"Connection refused" on port 11434 or 6333**
Docker Desktop isn't running, or containers crashed. `vault-up` to restart. `vault-logs` for details.

**Vault path elsewhere**
Set `VAULT_PATH` before running `install.sh`:
```bash
VAULT_PATH="$HOME/obsidian-vaults/main" ./install.sh
```
To change after install: uninstall, re-install with the new path. (Or edit `~/.zshrc`, plist, and MCP config by hand.)

**Serena prompts on each tool call**
The installer only adds the safe read-only Serena tools to auto-allow by default — edit/write tools still prompt. To change, edit `~/.claude/settings.json` `permissions.allow`.

## Updating

Pull the repo, re-run `install.sh` — idempotent. For Serena itself:

```bash
cd ~/.serena/src/serena && git pull
```

For the stack images:

```bash
vault-down && docker compose -f ~/Knowledge/.claude-stack/compose.yml pull && vault-up
```
