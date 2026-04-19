# Post-install

## First things first

1. **Restart Claude Code** — so it picks up the new MCP servers (`serena`) and settings env (`CLAUDE_CODE_DISABLE_AUTO_MEMORY`, if you chose vault-only memory routing).
2. **Open a new terminal** (or `exec zsh`) — so shell aliases load.

## Verify

In a new shell:

```bash
vault-status        # should show metalmind-ollama + metalmind-qdrant running
vault-doctor        # vault hygiene report (duplicates, orphans, dead links, stale inbox)
metalmind pulse     # (or: metalmind doctor) — end-to-end install sanity check
```

In Claude Code, ask something conceptual — Claude should call `Bash: metalmind tap copper "<query>"` (or `metalmind recall` on classic flavor). No MCP tool schemas are injected for vault recall; it runs as a CLI to save context tokens. If you just installed, the vault is empty, so results will be sparse. Save a first note:

```
/save
```

Then paste a decision or insight. Claude proposes a filename, folder, and wikilinks; you approve; it writes to the vault. The watcher auto-reindexes within ~3 seconds.

## Shell aliases

Sourced from `~/.metalmind-stack/aliases.sh` via `~/.zshrc`.

| Alias | What it does |
|---|---|
| `vault-up` | Start Docker stack |
| `vault-down` | Stop Docker stack |
| `vault-status` | Show container status |
| `vault-logs` | Tail container logs |
| `vault-index` | Rebuild full index from scratch (`metalmind-vault-rag-indexer`) |
| `vault-doctor` | Vault hygiene (`metalmind-vault-rag-doctor --all`) |
| `vault-watcher-start` / `vault-watcher-stop` | Load/unload the launchd watcher |

## Serena: activating repos

The installer registers nothing by default. In Claude Code:

```
activate_project /path/to/your/repo
```

Serena auto-detects the primary language (TS, Python, Java, Go, Rust, …) and spins up the language server. First activation for a new language downloads the LSP binary (~100–200 MB). Cached after that.

Project configs live in `~/.serena/projects-data/<name>/` — outside your repos, so nothing to `.gitignore` per-repo.

## Recommended plugin pack

See [`plugins.md`](plugins.md).

## Troubleshooting

**Claude Code doesn't recall from the vault**
Ensure `metalmind-vault-rag-server` is on PATH (`which metalmind-vault-rag-server`). Run `vault-status` — containers must be up. Try `vault-logs` to see what Ollama and Qdrant are doing. Ask Claude to run `Bash: metalmind tap copper "test"` directly to verify the CLI path.

**Watcher not auto-reindexing**
```bash
launchctl list | grep vault-indexer
tail -f ~/Knowledge/.metalmind-stack/watcher.err
```
If the log shows a missing-binary error, reinstall the Python package: `metalmind init` (idempotent) or `uv tool install --reinstall --from <metalmind-cli>/templates/vault-rag-pkg metalmind-vault-rag`.

**"Connection refused" on port 11434 or 6333**
Docker Desktop isn't running, or containers crashed. `vault-up` to restart. `vault-logs` for details.

**Vault path elsewhere**
Re-run `metalmind init` and provide the new path at the prompt. Teardown + re-init is the supported path — there's no in-place mover.

**Serena prompts on each tool call**
Edit `~/.claude/settings.json` `permissions.allow` to auto-approve additional Serena tools.

## Updating

```bash
npm update -g metalmind
metalmind init    # re-run; idempotent, won't clobber customizations
```

For Serena: `uv tool install --upgrade serena-agent`.
For graphify: `uv tool install --upgrade graphifyy`.
For vault-rag: `uv tool install --reinstall --force --from <metalmind-cli>/templates/vault-rag-pkg metalmind-vault-rag` (or just re-run `metalmind init`).

For the stack images:

```bash
vault-down && docker compose -f ~/Knowledge/.metalmind-stack/compose.yml pull && vault-up
```
