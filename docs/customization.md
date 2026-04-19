# Customization

The stack is meant to be edited. Nothing is sacred — fork, strip, extend. Two rules:

1. User customizations go **outside** the metalmind sentinel markers in `CLAUDE.md` files. Everything inside `<!-- metalmind:managed:begin -->` … `<!-- metalmind:managed:end -->` gets refreshed on every `metalmind burn brass` / `metalmind stamp`.
2. Rules, agents, and commands under `~/.claude/` are **metalmind-owned** — they get overwritten on re-stamp. If you want to customize, create a sibling file (e.g. `~/.claude/agents/my-custom.md`) or rename.

## Adding your own rules

Drop `*.md` files into `~/.claude/rules/` with a non-metalmind filename. Reference them from your own text in `~/.claude/CLAUDE.md` (outside the managed block) under "Mandatory reads", or leave them for on-demand loading.

Convention:

```markdown
# My Rule

> **Scope**: when this applies
> **Priority**: when to override or defer

Content here.
```

## Adding your own agents

Drop `*.md` files into `~/.claude/agents/` with a non-metalmind filename (don't name it `architect.md` — you'd get overwritten on re-stamp). They appear in the agent picker on next Claude Code restart.

Agent frontmatter: `name`, `description`, `tools` (comma-separated), optional `model` and `color`.

## Changing the vault path

Re-run `metalmind init` and provide the new path. The wizard is idempotent; it will move managed files to the new location and update the config.

## Changing the embedding model

Default: `nomic-embed-text` (274 MB, 768-dim, fast, good enough for English notes).

1. `docker exec metalmind-ollama ollama pull <new-model>`
2. Set `VAULT_EMBED_MODEL=<new-model>` in your shell and in the launchd/systemd unit env
3. If the new model has a different dim, set `VAULT_EMBED_DIM=<n>` to match
4. `metalmind-vault-rag-indexer` — full re-embed (old vectors are incompatible)

Candidates: `mxbai-embed-large` (1024-dim, better recall, bigger), `snowflake-arctic-embed` (smaller, multilingual).

## Changing folder structure

Edit `cli/templates/vault/CLAUDE.md.block.template`, rebuild the CLI (`pnpm build` in `cli/`), then `metalmind burn brass`. Your existing folders are preserved; the sentinel block updates.

## Tweaking resource caps

`~/Knowledge/.metalmind-stack/compose.yml` — `mem_limit` and `cpus` per service. Re-run `vault-up` to apply.

Idle footprint target: ~300 MB. The Ollama model unloads after 1 minute idle (`OLLAMA_KEEP_ALIVE=1m`) and reloads in ~2 seconds when queried.

## Changing the Serena context

`~/.serena/serena_config.yml` — `default_modes`. The `--context` flag in `~/.claude.json` `mcpServers.serena.args` controls the context. Built-in contexts: `claude-code`, `ide`, `agent`, `desktop-app`.

## Bringing your own MCP servers

Add entries to `~/.claude.json` under `mcpServers`. `metalmind init` preserves unrelated entries and only manages `serena` (and strips any stale `vault-rag`). Your own entries are untouched.

## This is a starting point

The rules in `~/.claude/rules/principles.md` are opinionated defaults. Tweak them as you learn what Claude gets wrong for your workflow — your edits outside the managed block survive re-stamp.

Your vault is *yours*. Anything indexed is searchable. The more decisions you `/save`, the better recall gets. Aim for one `/save` per meaningful session, not per chat.
