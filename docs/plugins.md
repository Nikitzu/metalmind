# Plugins

The stack works fine without plugins — they're opt-in. `install-plugins.sh` installs a curated set from the official Claude Code marketplace.

## Recommended (installed by `install-plugins.sh`)

| Plugin | Why |
|---|---|
| `superpowers` | Process skills: brainstorming, TDD, systematic-debugging, verification-before-completion. Changes how Claude approaches work, not what it knows. |
| `context7` | Resolve unfamiliar library APIs against official docs instead of guessing from training data. |
| `commit-commands` | `/commit`, `/commit-push-pr`, `/clean_gone` — safer git workflow. |
| `code-review` | `/code-review` skill and `code-review:code-review` agent for structured PR review. |
| `claude-md-management` | Audit and improve `CLAUDE.md` files. Useful as your rules evolve. |
| `hookify` | Generate hooks from conversation patterns to prevent recurring mistakes. |
| `ui-ux-pro-max` | Design system guidance: color palettes, font pairings, layout patterns. Only useful if you do frontend work. |

## Optional (install yourself if you want them)

These require API keys or significant personal configuration — not scripted:

- **`linear@claude-plugins-official`** — Linear issue tracking. Requires Linear API key.
- **`figma@claude-plugins-official`** — Figma design integration. Requires Figma MCP connection.

Install via:

```
/plugin
```

inside Claude Code.

## Not recommended with this stack

- **`episodic-memory`** — semantic search across past Claude Code conversation transcripts. Overlaps with the vault + `/save` workflow. If you diligently save important insights, episodic-memory adds cost (system prompt tokens, duplicate lookup) without much benefit. Skip unless you want a fallback for things you never saved.
- **`firecrawl`** — web scraping. Requires API key and adds MCP overhead. Use `WebFetch` / `WebSearch` built-ins unless you specifically need crawling.

## Managing plugins

Inside Claude Code:

- `/plugin` — interactive UI: install, enable, disable, uninstall
- `/reload-plugins` — apply enable/disable changes

State lives in `~/.claude/plugins/installed_plugins.json`.

## Marketplace hygiene

Stick to one marketplace where possible. Duplicates (same skill from two marketplaces) waste system-prompt tokens. This pack uses only `claude-plugins-official`.

If you had the `superpowers-marketplace` installed for `episodic-memory`, you can safely remove it — all other superpowers content is in `claude-plugins-official`.
