---
description: Save the current session's key insight to the Obsidian Knowledge vault
---

You are saving a note to the user's personal Obsidian vault at `~/Knowledge/`.

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
- `Daily/YYYY-MM-DD.md` — append to today's daily log when the insight is time-bound
- `Inbox/` — if unsure, park here for later triage

## How to save

1. Propose a filename (kebab-case, descriptive) and target folder.
2. **Run `search_vault`** on the draft topic (top 5). If any existing note overlaps >50%, propose editing it instead of creating a new one.
3. Draft the note with:
   - Frontmatter: `tags`, `created` (today's date), `updated` (today), optionally `project`, `status: active`
   - Title as `# Heading`
   - Body that states WHY and the key insight, not a conversation replay
4. **Propose `[[wikilinks]]`** — from the `search_vault` results, pick the 1–3 most topically related notes and insert them as wikilinks in the body. If none relate, leave no forced links.
5. **Show the user the draft + proposed path + proposed links.** Wait for approval before writing.
6. On approval, write via the Write tool. The watcher auto-reindexes.

## Arguments

If the user passed text after `/save`, treat it as the topic/title hint.

User input: $ARGUMENTS
