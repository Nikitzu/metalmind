---
description: Save the current session's key insight to the Obsidian Knowledge vault
---

You are saving a note to the user's personal Obsidian vault.

## What to save

Extract the most valuable, non-obvious insight from this conversation. Prefer:

- Decisions and their reasoning (not code that can be read)
- Patterns, heuristics, or "gotchas" learned
- Connections between concepts
- User preferences/feedback surfaced in this session

Do **not** save:
- Summaries of what you did (the diff is the record)
- Transient task state
- Content already in the codebase or git history
- Secrets, tokens, credentials

## Where to save

Decide the right folder based on content:

- `Work/` — work-specific decisions, architecture, project notes
- `Learnings/` — reusable engineering patterns, language tricks, tooling insights
- `Personal/` — personal thoughts, non-work notes
- `Memory/` — agent feedback / preference notes
- `Daily/YYYY-MM-DD.md` — append to today's daily log when the insight is time-bound
- `Inbox/` — if unsure, park here for later triage

## How to save

1. Propose a filename and target kind (see valid kinds below).
2. **Run `Bash: {{RECALL_CMD}} "<draft-topic>" --deep`** to surface any existing notes that overlap. If one exists with >50% overlap, propose editing it instead of creating a new one.
3. Draft the note body. Frontmatter is stamped automatically by `metalmind scribe` — **do not hand-write `---` blocks**. Just write the body content.
4. **Propose `[[wikilinks]]`** — from the recall results in step 2, pick 1–3 most topically related notes and insert them as wikilinks in the body.
5. **Show the user the draft + proposed target + proposed links.** Wait for approval before writing.
6. On approval, write **exclusively** via metalmind. Every vault op has a scadrial name (themed) and a classic alias — both always work; use whichever the user's `CLAUDE.md` / shell habits prefer. Commands below show `scadrial` / `classic` side-by-side.

   | Intent | Scadrial | Classic |
   |---|---|---|
   | Create a new note | `metalmind scribe create "<title>" --kind <kind>` | `metalmind note create "<title>" --kind <kind>` |
   | Append to existing | `metalmind scribe update <kind:slug>` | `metalmind note update <kind:slug>` |
   | Replace one section | `metalmind scribe patch <kind:slug> --section "<h>"` | `metalmind note patch <kind:slug> --section "<h>"` |
   | Future daily note | `metalmind atium new --date <date>` | `metalmind daily new --date <date>` |
   | Push action item | `metalmind atium add "<item>" --date <date>` | `metalmind daily add "<item>" --date <date>` |
   | Archive | `metalmind gold <kind:slug>` | `metalmind scribe archive <kind:slug>` |
<!-- metalmind:notifications:start -->
   | Notify (macOS) | `metalmind flare banner "<t>" "<m>"` | `metalmind notify banner "<t>" "<m>"` |
<!-- metalmind:notifications:end -->

   Common flags: `--project <slug>`, `--tags a,b`, body on stdin, `--dry-run` for preview.

   **Never edit vault files directly with Write/Edit.** Direct writes bypass MOC linking, frontmatter stamping, and the watcher's indexing contract. If no metalmind command expresses your target — **stop and surface the gap** to the user. Do not reach for Write as a fallback.

   Valid `--kind` values: `plan`, `learning`, `work`, `daily`, `moc`, `inbox`, `memory`, `personal`.

   The metalmind watcher auto-reindexes within ~3 seconds.

<!-- metalmind:eod:start -->
## End-of-day hook

If the current **local time** is between **16:00 and 18:00** (i.e., the local hour is 16 or 17), the user is likely wrapping up their workday. After writing the insight note:

1. **Offer** to push any unresolved work as action items into the next workday's daily note. Example wording: "Looks like end of day — want me to push today's pending items to tomorrow's note?"
2. Wait for approval. On approval, run `metalmind atium add "<item>" --date next-workday` (or classic `metalmind daily add …`) once per item.
<!-- metalmind:notifications:start -->
3. On macOS, fire a confirmation banner: `metalmind flare banner "metalmind" "saved to <path>"` (or classic `metalmind notify banner …`).
<!-- metalmind:notifications:end -->

If the local hour is outside 16–17, skip this hook entirely — no need to offer or mention it.

<!-- metalmind:eod:end -->
## Arguments

If the user passed text after `/save`, treat it as the topic/title hint.

User input: $ARGUMENTS
