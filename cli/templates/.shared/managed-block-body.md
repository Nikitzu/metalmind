## Memory — metalmind

Vault at `{{VAULT_PATH}}`. Recall before any non-trivial task. Run `Bash: {{RECALL_CMD}} "<query>"` before architecture, design, debugging, planning, or `/save`. Add `--deep` for related notes, `--expand` for linked context. Rephrase 2-3× if first query misses — the vault may use different wording.

Save decisions via `/save` skill. Propose path + content before writing. Folders: `Plans/` · `Work/` · `Work/MOCs/` · `Learnings/` · `Daily/` · `Inbox/` · `Memory/` · `Personal/` · `Archive/`.

Command families — use `/metalmind-cli` skill for full reference, flags, and gotchas:

| Command | Purpose |
|---|---|
| `{{RECALL_CMD}} "<query>"` | Semantic recall (`--deep`, `--expand`) |
| `metalmind scribe <verb>` | Note CRUD: create, update, patch, delete, archive, rename. `kind:slug` shortcuts. `--dry-run` on all mutating verbs |
| `metalmind scribe list\|show` | Read-only note queries |
| `metalmind atium new\|add` | Daily-note action items (`--date <YYYY-MM-DD>`) |
| `metalmind forge` | Cross-repo route edges, OpenAPI spec management |
| `metalmind gold <kind:slug>` | Archive shortcut |
| `metalmind flare` | macOS notifications (banner, dialog, sticky) |

Write vault notes via metalmind — not raw `Write`/`Edit`. If no command fits, surface the gap.

Skip recall for one-off syntax lookups and transient state (git log covers it).
