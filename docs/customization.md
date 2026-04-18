# Customization

The stack is meant to be edited. Nothing is sacred — fork, strip, extend.

## Adding your own rules

Drop `*.md` files into `~/.claude/rules/`. They're not auto-loaded — reference them from `~/.claude/CLAUDE.md` under "Mandatory reads" to make Claude read them every session, or leave them for on-demand loading.

Convention:

```markdown
# My Rule

> **Scope**: when this applies
> **Priority**: when to override or defer

Content here.
```

## Adding your own agents

Drop `*.md` files into `~/.claude/agents/`. They appear in the `Agent` tool picker on next restart.

Agent file structure: see any of the 15 bundled files for the format. Key fields in frontmatter: `name`, `description`, `tools`.

## Changing the vault path

The whole stack reads `VAULT_PATH` from the environment. Places to update if you move the vault after install:

1. `~/.zshrc` — change the `export VAULT_PATH=...` line (or rely on `~/.claude-knowledge-stack/aliases.sh`)
2. `~/.claude.json` — the `vault-rag` MCP entry's `env.VAULT_PATH`
3. `~/Library/LaunchAgents/com.claude.vault-indexer.plist` — `EnvironmentVariables.VAULT_PATH` and the paths in `ProgramArguments`
4. `~/.claude/CLAUDE.md` — the `Storage:` line under "Memory — Obsidian vault"

Then: `launchctl unload <plist> && launchctl load <plist>`, restart Claude Code, `exec zsh`.

## Changing the embedding model

Default: `nomic-embed-text` (274 MB, 768-dim, fast, good enough for English notes).

To switch models:

1. `docker exec knowledge-ollama ollama pull <new-model>`
2. In `templates/claude-stack/vault_rag/core.py` (or `VAULT_EMBED_MODEL` env var): update `MODEL`
3. If new model has different dim: update `DIM` / `VAULT_EMBED_DIM`
4. `vault-index` — full re-embed (old vectors are incompatible)

Candidates: `mxbai-embed-large` (1024-dim, better recall, bigger), `snowflake-arctic-embed` (smaller, multilingual).

## Changing folder structure

Edit `templates/vault/CLAUDE.md` and the default-mkdir line in `install.sh`. Re-run `install.sh` to apply to an existing vault — existing folders are preserved.

## Tweaking resource caps

`~/Knowledge/.claude-stack/compose.yml` — `mem_limit` and `cpus` per service. Re-run `vault-up` to apply.

Defaults target an idle footprint of ~300 MB. The Ollama model unloads after 1 minute idle (`OLLAMA_KEEP_ALIVE=1m`) and reloads in ~2 seconds when queried.

## Changing the Serena context

`~/.serena/serena_config.yml` — `default_modes` controls the modes, and the `--context` flag in `~/.claude.json` mcpServers.serena.args controls the context. Built-in contexts: `claude-code`, `ide`, `agent`, `desktop-app`, etc.

## Bringing your own MCP servers

Add entries to `~/.claude.json` under `mcpServers`. The installer merges but never overwrites — your existing entries are preserved on re-run.

## Using this as a base, not a final state

The rules in `~/.claude/rules/principles.md` are a starting point — opinionated, terse. Tweak them as you learn what Claude gets wrong for your workflow. That's the whole point: Claude reads them every session, so small edits compound.

The vault is *yours* — anything indexed is searchable. The more decisions you `/save`, the better recall gets. Aim for one `/save` per meaningful session, not per chat.
