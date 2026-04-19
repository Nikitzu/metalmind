# Post-install

## First things first

1. **Restart Claude Code** — so it picks up the new MCP servers (`serena`), settings env (`CLAUDE_CODE_DISABLE_AUTO_MEMORY`, if you chose vault-only memory routing), and the stamped CLAUDE.md block.
2. **Open a new terminal** (or `exec zsh`) — so shell aliases load.

## Verify

In a new shell:

```bash
vault-status              # should show metalmind-ollama + metalmind-qdrant running
metalmind pulse --deep    # or: metalmind doctor --deep — end-to-end runtime check
```

`metalmind pulse --deep` probes:

- Docker containers (`metalmind-ollama` + `metalmind-qdrant`)
- Qdrant collection exists and has points
- Ollama has `nomic-embed-text` pulled
- Watcher service is loaded (launchd on macOS, systemd --user on Linux)
- The metalmind-managed blocks are present in `~/.claude/CLAUDE.md` and `<vault>/CLAUDE.md`

Each failing check suggests the exact remediation command.

In Claude Code, ask a conceptual question — Claude should call `Bash: metalmind tap copper "<query>"` (or `metalmind recall` on classic flavor). No MCP tool schemas are injected for vault recall; the stamped CLAUDE.md block tells Claude to reach for the CLI. Fresh vaults are empty — save a first note:

```
/save
```

Paste a decision or insight. Claude proposes a filename, folder, and wikilinks; you approve; it writes to the vault. `metalmind store copper` synchronously reindexes the new note via `metalmind-vault-rag-indexer --paths`, so recall sees it immediately. The watcher picks up changes from outside metalmind (editor saves, git pulls) within ~3 seconds.

## Shell aliases

Sourced from `~/.metalmind/aliases.sh` via `~/.zshrc` and `~/.bashrc`.

| Alias | What it does |
|---|---|
| `vault-up` | Start Docker stack |
| `vault-down` | Stop Docker stack |
| `vault-status` | Show container status |
| `vault-logs` | Tail container logs |
| `vault-index` | Rebuild full index (`metalmind-vault-rag-indexer`) |
| `vault-doctor` | Vault hygiene (`metalmind-vault-rag-doctor`) |
| `vault-watcher-start` / `vault-watcher-stop` / `vault-watcher-status` | Control the watcher service (launchd on macOS, systemd on Linux) |

## Upgrading metalmind

```bash
npm update -g metalmind
metalmind burn brass        # or: metalmind stamp
```

`metalmind burn brass` (Soother) re-imprints every metalmind-managed file on your system: rules, agents, commands, the sentinel blocks in both CLAUDE.md files, shell aliases, launchd/systemd unit, and memory-routing settings. User content outside the managed sentinel markers is preserved. Use this instead of re-running the full `metalmind init` wizard.

## Serena: activating repos

The installer registers nothing by default. In Claude Code:

```
activate_project /path/to/your/repo
```

Serena auto-detects the primary language (TS, Python, Java, Go, Rust, …) and spins up the language server. First activation for a new language downloads the LSP binary (~100–200 MB). Cached after that.

Project configs live in `~/.serena/projects-data/<name>/` — outside your repos.

## Recommended plugin pack

See [`plugins.md`](plugins.md).

## Troubleshooting

**`metalmind pulse --deep` says "sentinel block missing"**
Run `metalmind burn brass` — this re-applies all managed blocks without touching your custom content.

**Claude Code doesn't recall from the vault**
Ensure `metalmind-vault-rag-server` is on PATH (`which metalmind-vault-rag-server`). Run `vault-status` — containers must be up. Try `vault-logs` for Ollama / Qdrant errors. Ask Claude to run `Bash: metalmind tap copper "test"` directly to verify the CLI path.

**Watcher not auto-reindexing**
```bash
vault-watcher-status
tail -f ~/Knowledge/.metalmind-stack/watcher.err
```
If the log shows a missing-binary error, run `metalmind burn brass` to re-render the unit file (which re-resolves the watcher binary path via `which`).

**"Connection refused" on port 11434 or 6333**
Docker isn't running, or containers crashed. `vault-up` to restart. `vault-logs` for details.

**Vault path elsewhere**
Re-run `metalmind init` and provide the new path at the prompt. Teardown + re-init is the supported path — there's no in-place mover.

**Serena prompts on each tool call**
Edit `~/.claude/settings.json` `permissions.allow` to auto-approve additional Serena tools.

## Updating engines

- Serena: `uv tool install --upgrade serena-agent`
- graphify: `uv tool install --upgrade graphifyy`
- vault-rag: `uv tool install --reinstall --force --from <metalmind-cli>/templates/vault-rag-pkg metalmind-vault-rag` (or `metalmind init` again)

For the Docker stack:

```bash
vault-down && docker compose -f ~/Knowledge/.metalmind-stack/compose.yml pull && vault-up
```
