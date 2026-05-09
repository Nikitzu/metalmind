## Memory — metalmind (recall BEFORE you think)

Vault at `{{VAULT_PATH}}` — auto-indexed in-process (sqlite-vec + fastembed, no daemon); recall goes through the `metalmind` CLI over loopback HTTP. No MCP tool schema is registered, so the standing context budget stays clean; query results are billed like any other bash output.

**Recall FIRST — before any non-trivial task.** The #1 failure mode is re-deriving what's already in the vault. Run `Bash: {{RECALL_CMD}} "<query>"` before:

- Answering any architecture, design, or debugging question
- Starting a feature, refactor, or migration
- Writing a plan document
- Running `/save` (recall first → surfaces edit-existing candidates, prevents duplicate notes)

Default is fast semantic search. Add `--deep` for hits + related notes in one call; `--expand` for the full linked-context graph. `Read` / `Grep` are for exact paths and exact string matches only.

**Recall doesn't find it first try?** The retriever is a single embedding pass over your phrasing. If the vault uses different wording, run `{{RECALL_CMD}}` 2–3× with rephrasings (literal terms, synonyms, the acronym, the spelled-out form) and union the hits before deciding nothing is there. One miss is not a miss.

**Save decisions, not code.** Use the `/save` skill. Propose path + content before writing; never save silently. Folders: `Plans/` · `Work/` · `Work/MOCs/` · `Learnings/` · `Daily/` · `Inbox/` · `Memory/` · `Personal/` · `Archive/`. Plans live flat at `{{VAULT_PATH}}/Plans/YYYY-MM-DD-<topic>.md` — indexed automatically. Project grouping comes from the `project:` frontmatter field plus a matching MOC at `Work/MOCs/<project>.md`; no per-project subfolders.

**Write vault notes via metalmind — never raw `Write`/`Edit` on vault files.** If no metalmind command fits your target, **stop and surface the gap** — do not reach for `Write` as a fallback. Direct writes bypass MOC linking, frontmatter stamping, and the watcher's indexing contract. The write surface:

- **Note CRUD (mutating):** `metalmind scribe <create|update|patch|delete|archive|rename>` (classic: `metalmind note <verb>`). Stamps frontmatter, picks the right folder, auto-links the project MOC, rewrites `[[wikilinks]]` on rename. Body on stdin; `<note>` accepts `kind:slug` shortcuts (`learning:foo`, `plan:2026-04-21-bar`, `daily:2026-04-21`). All mutating verbs support `--dry-run`.
- **Note read-only:** `metalmind scribe list | show` — queries, no writes, no `--dry-run`.
- **Daily-note action items (canonical for daily):** `metalmind atium new|add --date <today|tomorrow|next-workday|YYYY-MM-DD>` (classic: `metalmind daily new|add`). Use this instead of scribe for daily checklists.
- **Daily-note dates ≠ today:** every mutating scribe verb refuses to touch `Daily/YYYY-MM-DD.md` when the date isn't today, unless `--date <YYYY-MM-DD>` acknowledges the target. Error messages name the date and print the exact flag.
- **Archive shortcut:** `metalmind gold <kind:slug>` (classic: `metalmind scribe archive <kind:slug>`).
- **macOS notification:** `metalmind flare banner|dialog|sticky` (classic: `metalmind notify …`).

Run `metalmind scribe --help` for flags.

**Forge cross-repo route edges** need OpenAPI specs on the metalmind shelf — never inside the target repo. Populate once with `metalmind forge capture-spec <repo> <url-or-file>` (`forge spec-list` / `spec-remove` manage it).

**When NOT to recall**: one-off syntax lookups (training knowledge is fine) and transient state (the git log already records it).
