---
name: writing-vault-notes
description: "Use when creating or editing markdown notes in a metalmind vault — any time the user says 'save this', 'note that', 'add to the vault', updates an existing note, or pipes a body through `metalmind scribe create|update|patch`. Covers Obsidian Flavored Markdown (wikilinks, embeds, callouts, tags, block refs, highlights, tasks) as the supported syntax dialect and metalmind conventions; scribe stamps frontmatter, plain-stem wikilinks (no `kind:` prefix), folder-by-intent not by project, link new notes from their MOC. Invoke before writing any note body, even if the user's request is one sentence."
model: sonnet
---

# Writing Vault Notes

Notes in a metalmind vault are plain markdown with Obsidian Flavored Markdown (OFM) extensions. This skill teaches the syntax that matters and the metalmind conventions that keep notes discoverable via `metalmind tap copper` and via graph traversal.

## Scope

In scope: OFM syntax (wikilinks, embeds, callouts, tags, block refs, highlights, comments, tasks), frontmatter conventions, metalmind `scribe` integration.

Out of scope: Obsidian Bases (`.base`), JSON Canvas (`.canvas`), plugin-specific syntax (Dataview queries, Templater). If you need those, surface it — they're separate concerns.

## Core metalmind rules

**Every vault operation goes through metalmind — never `Write`/`Edit` on vault files directly.** The write surface:

| Intent | Scadrial | Classic |
|---|---|---|
| Note CRUD — mutating (create / update / patch / delete / archive / rename) | `metalmind scribe <verb>` | `metalmind note <verb>` |
| Note CRUD — read-only (list / show) | `metalmind scribe list\|show` | `metalmind note list\|show` |
| Daily action items (canonical for daily checklists) | `metalmind atium new\|add --date <date>` | `metalmind daily new\|add --date <date>` |
| Daily prose for non-today date | `metalmind scribe update daily:<YYYY-MM-DD> --date <YYYY-MM-DD>` | `metalmind note update daily:<YYYY-MM-DD> --date <YYYY-MM-DD>` |
| Archive a note (one-shot) | `metalmind gold <kind:slug>` | `metalmind scribe archive <kind:slug>` |
| Desktop notification (macOS) | `metalmind flare banner\|dialog\|sticky` | `metalmind notify banner\|dialog\|sticky` |

Both names always work — prefer whichever the user's `CLAUDE.md` suggests. If a command errors with `unknown command`, check the table above before assuming the CLI can't express your target.

**`metalmind scribe` stamps frontmatter.** When piping a body through `scribe create|update|patch`, emit the body only — no `---` YAML block. Scribe writes `tags`, `created`, `updated`, `project`, `status` based on flags and the `kind:slug` target.

**Daily notes for non-today dates require explicit `--date`.** Every mutating scribe verb (`create`, `update`, `patch`, `delete`, `archive`, `rename`) refuses to touch `Daily/YYYY-MM-DD.md` when the resolved date ≠ today, unless you pass `--date <today|tomorrow|next-workday|YYYY-MM-DD>` to acknowledge the target date explicitly. The error names the resolved date and prints the exact flag invocation that would have worked. **Canonical path for adding action items to a future daily note is `metalmind atium add --date <date>`** — scribe is for prose; atium is for daily checklists. For prose into a future daily, `scribe update daily:YYYY-MM-DD --date YYYY-MM-DD` is acceptable when the date is intentional.

**Valid `kind:` prefixes** (these are the only ones — passing anything else throws `unknown kind`):

| Kind | Folder | Intent |
|------|--------|--------|
| `plan:` | `Plans/` | Implementation plans, dated filename |
| `learning:` | `Learnings/` | Durable cross-session lessons |
| `work:` | `Work/` | Active project notes |
| `moc:` | `Work/MOCs/` | Map-of-Content for a project |
| `daily:` | `Daily/` | Journal entry (filename = today's date) |
| `inbox:` | `Inbox/` | Triage / transient capture |
| `memory:` | `Memory/` | Model-managed context notes |
| `personal:` | `Personal/` | Non-work |

**Do not use the `Write` tool on vault files.** Every target has a metalmind command (scribe / atium / gold / flare). If none fits, stop and surface the gap — do not bypass.

## Workflow

1. **Recall first.** Run `metalmind tap copper "<topic>"` before writing. Surfaces an existing note to update (via `scribe update`/`patch`) instead of creating a duplicate.
2. **Pick the intent folder**, not a per-project subdir: `Work/`, `Personal/`, `Learnings/`, `Daily/`, `Inbox/`, `Plans/`, `Archive/`.
3. **Write the body** using the syntax below. No frontmatter when piping through scribe.
4. **Link internally via wikilinks.** Use plain stem links — `[[cache-fingerprints]]`, not `[[learning:cache-fingerprints]]`. Obsidian resolves stems vault-wide and has no `kind:` resolver; a `kind:` prefix yields an unresolvable link (`:` is an illegal filename char). The `kind:slug` form is for metalmind CLI arguments only, never wikilink bodies.
5. **Pass to scribe on stdin:** `printf '%s' "$body" | metalmind scribe create learning:my-topic`.

## Syntax reference

### Wikilinks

```
[[Note Name]]
[[Note Name|display text]]
[[Note Name#Heading]]
[[Note Name#^block-id]]
[[cache-fingerprints]]              # plain stem — resolves vault-wide
[[2026-04-22-my-topic]]
```

Wikilinks resolve by filename stem (no `.md`, no folder path). Be consistent with case — some vaults are case-sensitive.

> **Never put a `kind:` prefix inside `[[ ]]`.** `[[learning:slug]]` is unresolvable in Obsidian — `:` is an illegal filename char, so a click triggers a "File name cannot contain..." error. `kind:slug` is a metalmind CLI argument form (`scribe create learning:foo`, `gold plan:bar`) — not a wikilink.

### Embeds

Same as wikilinks, prefixed with `!`:

```
![[Note Name]]                      # embed whole note
![[Note Name#Section]]              # embed section only
![[Note Name#^block-id]]            # embed a single block
![[image.png|400]]                  # image at 400px width
```

### Frontmatter (only when writing raw, not through scribe)

```yaml
---
tags: [metalmind, architecture]
created: 2026-04-22
updated: 2026-04-22
project: metalmind
status: active
---
```

### Callouts

```
> [!note] Optional title
> Body text. Supports **markdown** inside, including nested
> lists and [[wikilinks]].

> [!warning] Heads up
> Warning body.

> [!tip]- Collapsed by default
> Hidden until expanded. The trailing `-` means "start collapsed".

> [!example]+ Expanded by default
> Force-open. The trailing `+` means "start expanded".
```

Common types: `note`, `info`, `abstract`, `tip`, `success`, `question`, `warning`, `failure`, `danger`, `bug`, `example`, `quote`, `todo`.

### Tags

Inline in body, or as an array in frontmatter. Hierarchical with `/`:

```
Context: this relates to #metalmind and #architecture/caching.
```

Tags are for cross-cutting themes, not categories. Use the frontmatter `project:` field for project affiliation — that's how MOCs group their notes via Dataview.

### Block references

Anchor a block so other notes can link or embed just that block:

```
This is the key finding — cache keys must include every real input. ^cache-key-insight
```

Reference elsewhere via `[[Note#^cache-key-insight]]` or embed via `![[Note#^cache-key-insight]]`.

### Tasks

Standard markdown:

```
- [ ] Open
- [x] Done
```

Obsidian task-plugin extensions (still valid markdown without the plugin):

```
- [/] In progress
- [!] Important
- [?] Question
- [-] Cancelled
```

### Highlights and comments

```
==Important phrase==              # yellow highlight in Obsidian
%%Hidden comment%%                # not rendered, stays in source
```

### Math

```
Inline: $E = mc^2$

Block:
$$
\int_0^1 f(x)\,dx
$$
```

### Basic markdown

Headings `#`..`######`, bold `**x**`, italic `*x*`, inline code with backticks, fenced code blocks with a language tag (`` ```ts ``) so search and render both work.

## Metalmind conventions

### Folder by intent, not by project

| Folder | What goes here |
|--------|----------------|
| `Work/` | Active project notes, architecture, decisions |
| `Work/MOCs/` | One Map-of-Content per project (`<project>.md`) |
| `Personal/` | Non-work |
| `Learnings/` | Durable cross-session lessons — the "I will never again..." file |
| `Plans/` | Implementation plans, flat, named `YYYY-MM-DD-<topic>.md` |
| `Daily/` | Journal entries |
| `Inbox/` | Transient — triage later |
| `Archive/` | Shipped or superseded — kept for the "why did we decide X in April?" question |
| `Memory/` | Model-managed context (rare) |

Project affiliation lives in frontmatter (`project: metalmind`), and a matching MOC at `Work/MOCs/<project>.md` collects notes via Dataview. No per-project subfolders.

### Body conventions

- Lead with one sentence saying what the note is and why it exists. Future-you scans, doesn't read.
- Use headings to chunk. Long prose walls don't survive six months.
- Wikilink liberally. An unlinked note is invisible to the graph.
- Put code and config in fenced blocks with the language tag.
- Use plain stem links (`[[my-note]]`) — never raw paths, never `kind:` prefixes. scribe rewrites stems on rename.

### What NOT to write

- Don't duplicate what recall surfaces. Use `scribe update` / `scribe patch` on the existing note.
- Don't include frontmatter when piping through scribe — it gets double-stamped.
- Don't write session-transient state (debug noise, test runs, intermediate scratchpads). The vault is for decisions and learnings, not logs. The git history is for "what happened".
- Don't create a note unless it will be linked from something. Orphans rot.

## Example

A learning note — body passed as stdin to `metalmind scribe create learning:cache-fingerprints-need-all-inputs`:

```markdown
Cache staleness fingerprints must include every real input, not just the first one. When we added OpenAPI specs as a second input to forge's merged cache, we forgot to hash them — so spec edits didn't invalidate the cache and downstream edges stayed stale.

## Signal

If a cache keys on a subset of its real inputs, it will eventually serve stale data. The bug won't surface until the omitted input changes.

## Fix pattern

Hash all inputs into the cache key, even ones you think "shouldn't change often". Cheap to include, expensive to debug.

See [[forge-merged-cache-architecture]] for the full fingerprint design. Related: [[loopback-http-is-still-local-first]].

> [!tip]
> When in doubt, include the input. A too-aggressive cache miss is a non-event; a too-aggressive cache hit is a silent data corruption.
```

Scribe stamps the frontmatter (`tags: [metalmind, learning, caching]`, `created: <today>`, `project: metalmind`, `status: active`) and places the file at `Learnings/cache-fingerprints-need-all-inputs.md`. The project MOC at `Work/MOCs/metalmind.md` picks it up automatically via the Dataview query.

## Quick reference

| Need | Syntax |
|------|--------|
| Link to note | `[[Note Name]]` |
| Link with alias | `[[Note Name\|shown text]]` |
| Link to heading | `[[Note Name#Heading]]` |
| Link to block | `[[Note Name#^block-id]]` |
| Internal link | `[[slug]]` — plain stem, no `kind:` prefix, no path |
| Embed note | `![[Note Name]]` |
| Embed image sized | `![[file.png\|400]]` |
| Callout | `> [!note]` then body on next `>` lines |
| Collapsed callout | `> [!tip]-` |
| Tag | `#topic` or `#topic/sub` |
| Block anchor | `text ^block-id` at end of line |
| Highlight | `==text==` |
| Hidden comment | `%%hidden%%` |
| Task | `- [ ]` / `- [x]` / `- [/]` / `- [!]` |

## Common mistakes

- **Frontmatter in the body when using scribe.** Scribe stamps, so you get two `---` blocks. Body only.
- **Raw paths in wikilinks.** Links are stem-based, not path-based. `[[my-note]]` works anywhere in the vault.
- **Over-tagging.** Three focused tags beat ten generic ones. Use frontmatter `project:` for project affiliation — not a `#metalmind` tag duplicating it.
- **Malformed callout header.** `> [!note]` needs the exclamation inside brackets and a line break before the body. No `:` or `-` after the closing bracket unless you mean the collapse marker.
- **Orphan notes.** A note that only exists on disk is invisible. Link it from the project MOC or from a sibling note before you write it.
- **Writing the same learning twice.** Recall surfaces the existing note; update it, don't fork it. Duplicate notes dilute the graph.
