# Customization

The stack is meant to be edited. Nothing is sacred - fork, strip, extend. Two rules:

1. User customizations go **outside** the metalmind sentinel markers in `CLAUDE.md` files. Everything inside `<!-- metalmind:managed:begin -->` … `<!-- metalmind:managed:end -->` gets refreshed on every `metalmind burn brass` / `metalmind stamp`.
2. Rules, agents, and commands under `~/.claude/` are **metalmind-owned** - they get overwritten on re-stamp. If you want to customize, create a sibling file (e.g. `~/.claude/agents/my-custom.md`) or rename.

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

Drop `*.md` files into `~/.claude/agents/` with a non-metalmind filename (don't name it `architect.md` - you'd get overwritten on re-stamp). They appear in the agent picker on next Claude Code restart.

Agent frontmatter: `name`, `description`, `tools` (comma-separated), optional `model` and `color`.

## Project MOCs and the flat plans layout

metalmind assumes a **flat** `~/Knowledge/Plans/` - files are named `YYYY-MM-DD-<topic>.md`, chronological, no per-project subfolders. Project grouping lives in two places:

1. **Frontmatter** on every plan / work note:
   ```yaml
   ---
   project: <slug>
   tags: [<slug>, ...]
   status: active
   ---
   ```
2. **A map-of-content (MOC)** at `<Folder>/MOCs/<project>.md` - typically `Work/MOCs/<project>.md` - that links to every note in the project and (optionally) runs a Dataview query to surface the whole set live.

A ready-to-copy MOC scaffold ships at `cli/templates/vault/MOC.md.template`. Copy it, drop into `~/Knowledge/Work/MOCs/<project>.md`, replace the `<project>` placeholders, and start linking notes. Why this instead of per-project folders?

- No duplication between folder structure and frontmatter.
- Wikilinks are name-based in Obsidian - moving notes doesn't break them.
- Semantic recall (`metalmind tap copper "<project>"`) and the MOC's Dataview query both return the project view from the same single source of truth.
- Legacy notes still in old per-project subfolders keep working - wikilinks resolve by file stem - but new work should land flat.

## Changing the vault path

Re-run `metalmind init` and provide the new path. The wizard is idempotent; it will move managed files to the new location and update the config.

## Changing the embedding model

Default: `BAAI/bge-small-en-v1.5` via fastembed (~30 MB ONNX wheel, 384-dim, English-tuned, MTEB-strong). Cached at `~/.cache/fastembed/`.

1. Pick a fastembed-compatible model (anything in [`fastembed.TextEmbedding.list_supported_models()`](https://github.com/qdrant/fastembed))
2. Set `VAULT_EMBED_MODEL=<repo/model>` in your shell and in the launchd/systemd unit env
3. Set `VAULT_EMBED_DIM=<n>` to the new model's dimension (default 384 matches bge-small)
4. `metalmind-vault-rag-indexer --wipe` - full re-embed (old vectors are incompatible)

Candidates: `BAAI/bge-base-en-v1.5` (768-dim, better recall, ~110 MB), `BAAI/bge-large-en-v1.5` (1024-dim, ~350 MB), `intfloat/multilingual-e5-large` (1024-dim, multilingual).

### Using Ollama instead

If you want to host your own embedding model (custom fine-tune, GPU acceleration, etc.), set `METALMIND_BACKEND=legacy` in the watcher env and re-run `metalmind init --legacy`. The watcher then routes through Ollama (default `nomic-embed-text`, 768-dim) and writes to a Qdrant container instead of sqlite-vec. Same `VAULT_EMBED_MODEL` / `VAULT_EMBED_DIM` knobs apply.

## Changing folder structure

Edit `cli/templates/vault/CLAUDE.md.block.template`, rebuild the CLI (`pnpm build` in `cli/`), then `metalmind burn brass`. Your existing folders are preserved; the sentinel block updates.

## Tweaking resource caps

The default embedded backend has no daemon and no caps to tune. The fastembed model loads on first call (~50 MB resident), the watcher process holds it for the session (~150 MB total).

(`--legacy` only) Edit `~/Knowledge/.metalmind-stack/compose.yml` - `mem_limit` and `cpus` per service. Re-run `vault-up` to apply. Idle footprint target ~300 MB; the Ollama model unloads after 1 minute idle (`OLLAMA_KEEP_ALIVE=1m`) and reloads in ~2 s when queried.

## Changing the Serena context

`~/.serena/serena_config.yml` - `default_modes`. The `--context` flag in `~/.claude.json` `mcpServers.serena.args` controls the context. Built-in contexts: `claude-code`, `ide`, `agent`, `desktop-app`.

## Bringing your own MCP servers

Add entries to `~/.claude.json` under `mcpServers`. `metalmind init` preserves unrelated entries and only manages `serena` (and strips any stale `vault-rag`). Your own entries are untouched.

## This is a starting point

The rules in `~/.claude/rules/principles.md` are opinionated defaults. Tweak them as you learn what Claude gets wrong for your workflow - your edits outside the managed block survive re-stamp.

Your vault is *yours*. Anything indexed is searchable. The more decisions you `/save`, the better recall gets. Aim for one `/save` per meaningful session, not per chat.
