---
name: writing-vault-notes
description: Use when creating or editing markdown notes in an Obsidian vault through metalmind — any time the user says "save this", "note that", "add to the vault", updates an existing note, or pipes a body through `metalmind scribe create|update|patch`. Covers Obsidian Flavored Markdown (wikilinks, embeds, callouts, tags, block refs, highlights, tasks) and metalmind conventions: scribe stamps frontmatter, prefer `kind:slug` wikilinks, folder-by-intent not by project, link new notes from their MOC. Invoke before writing any note body, even if the user's request is one sentence.
---

# Writing Vault Notes

Notes in a metalmind vault are plain markdown with Obsidian Flavored Markdown (OFM) extensions. This skill teaches the syntax that matters and the metalmind conventions that keep notes discoverable via `metalmind tap copper` and via graph traversal.

## Scope

In scope: OFM syntax (wikilinks, embeds, callouts, tags, block refs, highlights, comments, tasks), frontmatter conventions, metalmind `scribe` integration.

Out of scope: Obsidian Bases (`.base`), JSON Canvas (`.canvas`), plugin-specific syntax (Dataview queries, Templater). If you need those, surface it — they're separate concerns.

## Core metalmind rules

**Every vault operation goes through `metalmind scribe <verb>`.** There is no top-level `metalmind show` / `metalmind list` / `metalmind create` — those all live as `scribe show`, `scribe list`, `scribe create`, etc. If you reach for `metalmind <verb>` and it errors with `unknown command`, the verb is almost always under `scribe`.

**`metalmind scribe` stamps frontmatter.** When piping a body through `scribe create|update|patch`, emit the body only — no `---` YAML block. Scribe writes `tags`, `created`, `updated`, `project`, `status` based on flags and the `kind:slug` target.

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

When writing directly through the `Write` tool (rare — only when `scribe` can't express what you need, e.g. editing a section the patch matcher can't target), include frontmatter explicitly and put the file in the correct intent folder yourself.

## Workflow

1. **Recall first.** Run `metalmind tap copper "<topic>"` before writing. Surfaces an existing note to update (via `scribe update`/`patch`) instead of creating a duplicate.
2. **Pick the intent folder**, not a per-project subdir: `Work/`, `Personal/`, `Learnings/`, `Daily/`, `Inbox/`, `Plans/`, `Archive/`.
3. **Write the body** using the syntax below. No frontmatter when piping through scribe.
4. **Link internally via wikilinks.** Prefer `[[kind:slug]]` shortcuts (`[[learning:cache-fingerprints]]`) — scribe resolves them to the right path and updates backlinks on rename.
5. **Pass to scribe on stdin:** `printf '%s' "$body" | metalmind scribe create learning:my-topic`.

## Syntax reference

### Wikilinks

```
[[Note Name]]
[[Note Name|display text]]
[[Note Name#Heading]]
[[Note Name#^block-id]]
[[learning:cache-fingerprints]]     # metalmind kind:slug shortcut
[[plan:2026-04-22-my-topic]]
```

Wikilinks resolve by filename stem (no `.md`, no folder path). Be consistent with case — some vaults are case-sensitive.

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
- Prefer `[[kind:slug]]` shortcuts over raw filenames — they survive renames.

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
| Metalmind shortcut | `[[learning:slug]]` / `[[plan:2026-04-22-topic]]` |
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
