# Post-install

## First things first

1. **Restart Claude Code** - so it picks up the new MCP servers (`serena`), settings env (`CLAUDE_CODE_DISABLE_AUTO_MEMORY`, if you chose vault-only memory routing), and the stamped CLAUDE.md block.
2. **Open a new terminal** (or `exec zsh`) - so shell aliases load.

## Verify

In a new shell:

```bash
metalmind pulse --deep    # or: metalmind doctor --deep - end-to-end runtime check
```

`metalmind pulse --deep` probes:

- Watcher service is loaded (launchd on macOS, systemd --user on Linux)
- Recall HTTP fast-path reachable at `127.0.0.1:17317`
- The metalmind-managed blocks are present in `~/.claude/CLAUDE.md` and `<vault>/CLAUDE.md`

For a deeper Python-side smoke check (FTS5 row count):

```bash
metalmind-vault-rag-doctor --fts
```

Judge health is `metalmind judge status`: it names where the key came from (`TYPESAFE_API_KEY`, macOS Keychain, or `pass`) or says the judge is off.

## Recall latency

`metalmind tap copper` has two transport paths:

1. **HTTP fast-path** (default, ~170ms median): hits the loopback endpoint co-hosted inside the watcher process - no Python spawn, no MCP handshake. `127.0.0.1:17317` only; nothing leaves your machine.
2. **Stdio MCP fallback** (~570ms): spawns `metalmind-vault-rag-server` via stdio if the HTTP endpoint is down (watcher not running, port in use, etc).

You never need to pick - the CLI tries HTTP first and falls back automatically. Override the endpoint with `METALMIND_RECALL_HTTP=...` if you want.

Each failing check suggests the exact remediation command.

In Claude Code, ask a conceptual question - Claude should call `Bash: metalmind tap copper "<query>"` (or `metalmind recall` on classic flavor). No MCP tool schemas are injected for vault recall; the stamped CLAUDE.md block tells Claude to reach for the CLI. Fresh vaults are empty - save a first note:

```
/save
```

Paste a decision or insight. Claude proposes a filename, folder, and wikilinks; you approve; it writes to the vault. `metalmind store copper` synchronously reindexes the new note via `metalmind-vault-rag-indexer --paths`, so recall sees it immediately. The watcher picks up changes from outside metalmind (editor saves, git pulls) within ~3 seconds.

## Shell aliases

Sourced from `~/.metalmind/aliases.sh` via `~/.zshrc` and `~/.bashrc`.

| Alias | What it does |
|---|---|
| `vault-index` | Rebuild full index (`metalmind-vault-rag-indexer`) |
| `vault-doctor` | Vault hygiene (`metalmind-vault-rag-doctor`) |
| `vault-watcher-start` / `vault-watcher-stop` / `vault-watcher-status` | Control the watcher service (launchd on macOS, systemd on Linux) |

## Upgrading metalmind

```bash
pnpm add -g metalmind@latest     # or: npm install -g metalmind@latest
```

That is the whole upgrade since 0.29.0. The next metalmind command notices the new version and runs `metalmind stamp --no-prompt` once before doing its own work, logging to `~/.metalmind/logs/auto-stamp.log` and printing one line to stderr. Set `METALMIND_NO_AUTO_STAMP=1` to turn that off and stamp by hand. Upgrading from an older release applies the same way, because no recorded version counts as out of date.

`metalmind burn brass` (Soother, alias `metalmind stamp`) re-imprints every metalmind-managed file on your system: rules, agents, commands, the sentinel blocks in the global and vault `CLAUDE.md` and the vault `AGENTS.md`, shell aliases, launchd/systemd unit, the watcher's Python package, and memory-routing settings. User content outside the managed sentinel markers is preserved. Run it yourself to change hosts, or instead of re-running the full `metalmind init` wizard.

A stamp never rewrites your notes. When notes carry `kind:` without `type:`, it prints how many and the command that adds it: `metalmind scribe backfill-type`. `metalmind doctor --deep` reports the same, plus whether the stamp matches the installed version.

## Serena: activating repos

The installer registers nothing by default. In Claude Code:

```
activate_project /path/to/your/repo
```

Serena auto-detects the primary language (TS, Python, Java, Go, Rust, …) and spins up the language server. First activation for a new language downloads the LSP binary (~100-200 MB). Cached after that.

Project configs live in `~/.serena/projects-data/<name>/` - outside your repos.

## Recommended plugin pack

See [`plugins.md`](plugins.md).

## Troubleshooting

**`metalmind pulse --deep` says "sentinel block missing"**
Run `metalmind burn brass` - this re-applies all managed blocks without touching your custom content.

**Claude Code doesn't recall from the vault**
Ensure `metalmind-vault-rag-server` is on PATH (`which metalmind-vault-rag-server`). Confirm the watcher is running (`vault-watcher-status`). Ask Claude to run `Bash: metalmind tap copper "test"` directly to verify the CLI path. Tail `~/.metalmind/logs/watcher.log` for Python-side errors.

**Watcher not auto-reindexing**
```bash
vault-watcher-status
tail -f ~/.metalmind/logs/watcher.log
```
If the log shows a missing-binary error, run `metalmind burn brass` to re-render the unit file (which re-resolves the watcher binary path via `which`).

**"Connection refused" on port 17317**
The watcher isn't running or the recall HTTP server failed to bind. `vault-watcher-start` to restart. Tail the log for details.

**Vault path elsewhere**
Re-run `metalmind init` and provide the new path at the prompt. Teardown + re-init is the supported path - there's no in-place mover.

**Serena prompts on each tool call**
Edit `~/.claude/settings.json` `permissions.allow` to auto-approve additional Serena tools.

## Updating engines

- Serena: `uv tool install --upgrade serena-agent`
- vault-rag: `uv tool install --reinstall --force --from <metalmind-repo>/packages/vault-rag metalmind-vault-rag` (or `metalmind init` again)

