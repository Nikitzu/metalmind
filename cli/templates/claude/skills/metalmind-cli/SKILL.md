---
name: metalmind-cli
description: "Full operational reference for the metalmind CLI - vault recall, note CRUD, daily notes, forge, archive, and notifications. Use when writing vault notes, managing daily action items, running forge commands, archiving notes, or when you need metalmind command flags and gotchas beyond the basic recall pattern in CLAUDE.md. Also use when the user mentions 'scribe', 'atium', 'forge', 'gold', 'flare', or asks about vault note conventions."
model: sonnet
---

# metalmind CLI Reference

Full operational reference. The CLAUDE.md memory section covers when and why to recall; this skill covers how - flags, gotchas, and conventions for each command family.

## Recall - `metalmind tap copper`

```bash
metalmind tap copper "<query>"          # Fast semantic search
metalmind tap copper "<query>" --deep   # Hits + related notes in one call
metalmind tap copper "<query>" --expand # Full linked-context graph
```

The retriever is a single embedding pass. If the vault uses different wording, run 2-3 queries with rephrasings (literal terms, synonyms, acronym, spelled-out form) and union the hits before concluding nothing is there.

## Note CRUD - `metalmind scribe`

### Mutating verbs

All mutating verbs support `--dry-run`. Body content is passed on **stdin**.

```bash
# Create
echo "note body" | metalmind scribe create "learning:my-discovery"

# Update (append to note, bump updated:)
echo "new lines" | metalmind scribe update "learning:my-discovery"

# Patch a ## section (replace its body)
echo "fresh content" | metalmind scribe patch "learning:my-discovery" --section "Heading"

# Patch a literal text block in place (frontmatter untouched; empty --replace deletes)
metalmind scribe patch "learning:my-discovery" --find "stale fact" --replace "fresh fact"

# Delete
metalmind scribe delete "learning:my-discovery"

# Rename (rewrites [[wikilinks]] across vault)
metalmind scribe rename "learning:old-name" "learning:new-name"

# Archive
metalmind scribe archive "learning:my-discovery"
# Shortcut: metalmind gold "learning:my-discovery"
```

### `kind:slug` shortcuts

The `<note>` argument accepts `kind:slug` format:

| Kind | Resolves to | Example |
|---|---|---|
| `learning:foo` | `Learnings/foo.md` | `learning:output-style-case-sensitive` |
| `plan:2026-05-12-bar` | `Plans/2026-05-12-bar.md` | `plan:2026-05-12-opus-47-setup` |
| `daily:2026-05-12` | `Daily/2026-05-12.md` | `daily:2026-05-12` |
| `work:baz` | `Work/baz.md` | `work:feature-auth-redesign` |
| `moc:project` | `Work/MOCs/project.md` | `moc:metalmind` |
| `memory:item` | `Memory/item.md` | `memory:preferred-stack` |
| `inbox:thing` | `Inbox/thing.md` | `inbox:rough-idea` |

### Read-only verbs

```bash
metalmind scribe list              # List all notes (JSON)
metalmind scribe list --kind learning  # Filter by kind
metalmind scribe show "learning:foo"   # Show note content + frontmatter
```

### Scribe behavior

- **Frontmatter stamping**: scribe auto-sets `created`, `updated`, `status`, `kind`, `project` fields
- **MOC auto-linking**: when `project:` is set in frontmatter, scribe ensures the note is linked from `Work/MOCs/<project>.md`
- **Wikilink rewriting**: `scribe rename` updates all `[[wikilinks]]` referencing the old name across the vault

## Daily notes - `metalmind atium`

Canonical interface for daily action items. Prefer over `scribe` for daily checklists.

```bash
metalmind atium new --date today          # Create today's daily note
metalmind atium new --date tomorrow       # Create tomorrow's
metalmind atium new --date next-workday   # Create next workday's
metalmind atium new --date 2026-05-15     # Specific date

metalmind atium add --date today "Review PR for auth feature"  # Add action item
```

### Date constraint

Every mutating scribe verb **refuses to touch** `Daily/YYYY-MM-DD.md` when the date isn't today, unless `--date <YYYY-MM-DD>` explicitly acknowledges the target date. Error messages name the date and print the exact flag needed.

## Forge - cross-repo route edges

OpenAPI specs for cross-repo route edges live on the metalmind shelf, not inside target repos.

```bash
metalmind forge capture-spec <repo> <url-or-file>  # Add spec to shelf
metalmind forge spec-list                           # List stored specs
metalmind forge spec-remove <repo>                  # Remove spec
```

## Archive - `metalmind gold`

Shortcut for `metalmind scribe archive`:

```bash
metalmind gold "learning:outdated-pattern"    # Archive a note
metalmind gold "plan:2026-01-15-old-plan"     # Archive a plan
```

## Notifications - `metalmind flare`

macOS native notifications:

```bash
metalmind flare banner "Build complete"       # Temporary banner
metalmind flare dialog "Deploy failed!"       # Modal dialog (requires dismiss)
metalmind flare sticky "Tests running..."     # Persistent notification
```

## Writing conventions

- **Write vault notes via metalmind, not raw `Write`/`Edit`**. Direct writes bypass MOC linking, frontmatter stamping, and the watcher's indexing contract.
- If no metalmind command fits the target, **stop and surface the gap** - do not reach for `Write` as a fallback.
- Save decisions, not code. Use the `/save` skill.
- Propose path + content before writing; do not save silently.

## Vault folders

| Folder | Purpose |
|---|---|
| `Plans/` | Flat, `YYYY-MM-DD-<topic>.md`. Project from frontmatter. |
| `Work/` | Active work notes |
| `Work/MOCs/` | Map-of-content per project |
| `Learnings/` | Durable insights |
| `Daily/` | Daily notes (via `atium`) |
| `Inbox/` | Unsorted captures |
| `Memory/` | Persistent preferences |
| `Personal/` | Non-work notes |
| `Archive/` | Retired notes (via `gold`) |
