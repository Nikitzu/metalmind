# Cookbook

Opinionated patterns for using metalmind well. Not a reference manual (the README + `metalmind --help` cover that). Not a getting-started (see [`post-install.md`](post-install.md)). This is "I've installed it, now what does excellent usage look like?"

Three sections in this v0:

1. [Writing a vault note Claude will find](#writing-a-vault-note-claude-will-find)
2. [Recall hygiene](#recall-hygiene)
3. [What lives where](#what-lives-where)

Deferred to v1: *Migrating from mem0 / Letta / Notion / scattered CLAUDE.md*, *Scaling past 10k notes*. Open an issue if you want either sooner.

---

## Writing a vault note Claude will find

A note that recall can find quickly is one that's *aligned* on three axes: title, frontmatter, and graph position. Default to all three.

### Frontmatter discipline (the biggest single lever)

`metalmind scribe` stamps frontmatter automatically when you pipe a body through it — but the fields you pass on the command line shape how recall treats the note for the rest of its life:

- **`--project <slug>`** — the strongest discoverability signal. Notes with `project: foo` automatically link to `Work/MOCs/foo.md` and surface together. Use a slug, not a label (`metalmind` not `metalmind project`). One project per note.
- **`--tags a,b,c`** — for cross-cutting *themes*, not categories. `caching`, `auth`, `regression-postmortem` are tags. `metalmind` would be a tag if it weren't already the project — don't double-encode. Three focused tags beat ten generic ones.
- **`--kind <plan|learning|work|moc|daily|inbox|memory|personal>`** — the folder. See [What lives where](#what-lives-where).

A frontmatter that looks right:

```yaml
---
project: metalmind
kind: learning
tags: [retrieval, caching, regression]
created: 2026-04-21
updated: 2026-04-21
status: active
---
```

A frontmatter that recall struggles with:

```yaml
---
tags: [thing, stuff, todo, important, work, project, metalmind, note]
status: maybe
---
```

Generic tags are noise. No project = no MOC = orphan in the graph.

### Title and first line

The title is the H1. The first sentence is the highest-weighted text the embedder sees. Make both of them carry the topic.

**Strong:**

> **# Cache staleness fingerprints must include every real input**
>
> Cache keys that hash a subset of their inputs eventually serve stale data. The bug won't surface until the omitted input changes.

**Weak:**

> **# notes**
>
> So I was thinking about caching today and...

If a future-you scans the first line of the file, can they tell whether it's the right note? If no, rewrite.

### `kind:slug` shortcuts in wikilinks

Prefer `[[learning:cache-fingerprints]]` over `[[cache-fingerprints]]` over `[[Learnings/cache-fingerprints.md]]`. The shortcut survives folder reorganisation and is the format `scribe rename` rewrites cleanly. Stem-only links work but break on rename if the stem isn't unique. Path links rot the moment the file moves.

```markdown
Reasoning lives in [[learning:silent-fallback-bugs-compound]] —
the same pattern bit us in [[plan:2026-04-30-metalmind-v0-4-0]].
```

### MOC linking — every project's index

`Work/MOCs/<project>.md` is the project's table of contents. Scribe auto-appends a backlink to the relevant MOC when you create a note with `--project`. Two failure modes worth catching:

- **Notes without `project:`** never get MOC linked. They become graph orphans. Recall can still find them via embedding similarity, but the surrounding-context graph won't surface them.
- **Notes with `project:` but no matching MOC file** get a fresh MOC scaffolded the first time. Scribe creates `Work/MOCs/<project>.md` with a stub. Edit it once to give the project an honest "current state" paragraph; that paragraph becomes the most-recalled-from-context note in the project.

### Anti-patterns to avoid

- **Orphan notes.** A note that nothing links to and that doesn't have a project is invisible to graph traversal. Either link it from a MOC, give it a project, or accept that it's a one-off you may never find again.
- **Duplicate notes.** The most expensive failure mode: re-deriving what's already in the vault. **Always recall first** (`metalmind tap copper "<topic>" --deep`) before writing — if there's a 50%+ overlap with an existing note, `scribe update` it instead of forking a new one.
- **Inline frontmatter when piping through scribe.** Scribe stamps frontmatter automatically. If your body starts with a `---` block, you'll end up with two — and the second one wins, silently overriding your fields. Body only when piping.
- **Diary-as-decision.** A daily note (`Daily/YYYY-MM-DD.md`) is a logbook. A learning (`Learnings/<topic>.md`) is a decision. Don't bury reusable insights in a daily — they won't surface in cross-project recall. Promote to a learning when you spot one.
- **Long notes with multiple topics.** One note = one topic. If a single note answers three questions, recall will return it for all three queries with weak-but-not-best scores. Split.

---

## Recall hygiene

### When to use which flag

| Flag | Use when | Cost |
|---|---|---|
| *(none)* | Default. Fast semantic + BM25 hybrid. The right answer 90% of the time. | ~8 ms median |
| `--deep` | One hit looks right but you want adjacent context. Walks backlinks one hop. | One extra round-trip; +1 hop of payload tokens. |
| `--expand` | Researching a topic broadly — you want hits *and* the linked-context graph. | Heavier — every linked note loaded. Use sparingly on large vaults. |
| `--rerank` | Top-of-list precision matters more than latency (cross-encoder rescore). | ~2 s per query; first call downloads ~150 MB ONNX weights. |
| `--list-recent N` | "What was I working on yesterday?" — no query, just the N most-recently-modified notes. | Cheap — pure file-mtime scan. |
| `-k <n>` | Limit hits returned. Default is 10. | Smaller payload. |
| `--json` | Scripted consumers. Tabular by default. | Same retrieval cost. |

**Default rule of thumb:** start with no flag. Escalate to `--deep` if the top hit is right but lacking context. Escalate to `--expand` only when you're researching *broadly*, not when you have a specific question. `--rerank` is for moments when you'll quote the top hit verbatim.

### The 2–3 rephrasings rule

The retriever is a single embedding pass over your phrasing. If the vault uses different wording, one query will miss. Rephrase 2–3 times and union the hits before deciding nothing is there.

A good rephrasing ladder:

1. **Literal** — the words you'd use in a slack message. *"why did we reject Auth0?"*
2. **Domain term** — the technical primitive. *"auth provider rejection rationale"*
3. **Acronym ↔ spelled out** — *"OAuth PKCE flow decision"* / *"Proof Key for Code Exchange decision"*
4. **Verb-vs-noun** — sometimes flipping from "saved decision X" to "decision about X" finds the right note.
5. **Negative framing** — *"why we don't use Auth0"* instead of *"why we use X"*.

If three rephrasings still find nothing, you genuinely don't have a note on that topic. Time to write one.

### Reading the recall log to find weak queries

`metalmind doctor --recall-audit` replays the opt-in recall log and tells you which of *your* queries are failing. To enable it, set `METALMIND_RECALL_LOG_PATH=~/.metalmind/recall-log.ndjson` in your shell rc. Then a week or two later:

```bash
metalmind doctor --recall-audit --recall-audit-days 14
```

Output shows top 25 unique candidates ranked by frequency, classified as:

- **`ok`** — recall hit something with score ≥ 0.3.
- **`weak-hit`** — top score < 0.3. Either the query is unusual or the matching note is buried.
- **`zero-hit`** — no hits at all. Either you genuinely don't have a note on that topic, or your wording diverges hard from the vault's wording. Worth investigating each.

The recall log is local-only, opt-in, and never leaves your machine. Don't enable it on a vault that contains client secrets.

### When recall fails: triage ladder

1. **Try 2–3 rephrasings** (see above).
2. **Run `--list-recent 20`** — sometimes you remember writing it, you just don't remember the topic words. Recent-list often surfaces the right note.
3. **Check the project MOC** — if the topic is project-scoped, `Work/MOCs/<project>.md` is the curated index.
4. **Check the watcher** — `metalmind pulse --deep`. If the watcher is down, recall falls back to MCP stdio (~570ms) and the index may be stale.
5. **`metalmind-vault-rag-doctor --fts`** — surfaces the FTS5 row count. If FTS5 is empty, hybrid retrieval has only the semantic side and BM25 hits go missing.

### Save what's not there

If a triage walk concludes "we should have had a note on this and didn't" — that's a `/save` moment. The recall-audit pattern compounds: the more weak-hit queries you turn into notes, the fewer your future weak-hit queries.

---

## What lives where

Folder-by-intent, not by project. Project affiliation is in the `project:` frontmatter field; folders are about *what kind of thing* the note is.

### `Plans/` — implementation plans

**What goes here:** plans for feature work, refactors, migrations. Dated filename (`YYYY-MM-DD-<topic>.md`). Kept flat — no per-project subfolders.

**Anchors:** `kind: plan`. `project: <slug>` for affiliation. `status: active | partially-shipped | archived`.

**Lifecycle:** active while the work is in flight, partially-shipped when most slices ship but residuals remain, archived once it's done. Move archived plans to `Archive/Plans/` via `metalmind gold plan:<slug>` to keep `Plans/` honest.

**Anti-pattern:** plans that read like meeting notes. A plan should answer *"what are we shipping, in what order, with what done-criteria"*. If it's just a brain-dump, it's a `Work/` note, not a plan.

### `Learnings/` — durable cross-session lessons

**What goes here:** the "I will never again..." file. Reusable engineering insights, language tricks, tooling gotchas, debug postmortems where the lesson generalises. Filename is `kebab-case-of-the-lesson.md`.

**Anchors:** `kind: learning`. `tags: [topic, …]` for cross-cutting themes. `project:` only if the lesson is project-specific (rare — most learnings are general).

**Lifecycle:** evergreen. A learning is a permanent note. Edit it as new evidence arrives; rarely archive.

**The framing test:** *"would this insight apply to a different repo or a different team?"* If yes → learning. If no → it's a `Work/` decision scoped to that project.

### `Work/` — active project notes, decisions, architecture

**What goes here:** project-scoped decisions, architecture notes, design docs, debugging notes that don't generalise into a learning. Free-form filename (`auth-flow-decision.md`).

**Anchors:** `kind: work`. `project: <slug>` (essentially required — work without a project is hard to find).

**Lifecycle:** active while the project is active. Archive when the project ships or sunsets.

### `Work/MOCs/<project>.md` — Map of Content per project

**What goes here:** *one* MOC per project. The "current state" paragraph + a curated linked-list of every note in the project + a Dataview query as a fallback for anything not curated.

**Anchors:** `kind: moc`. `project: <slug>` (matches the filename stem).

**Discipline:** maintained by hand for the *current state* paragraph. The Dataview list at the bottom is auto-populated. Update the current-state paragraph after every shipped milestone — that paragraph is the most-recalled-from-context note in the entire project.

### `Daily/YYYY-MM-DD.md` — journal entries

**What goes here:** time-bound stuff. End-of-day reflections. Open action items via `metalmind atium add`. The "I noticed X today and want to revisit" thread.

**Anchors:** `kind: daily`. Filename is the date.

**Discipline:** scribe writes daily notes only for today (the date guard refuses non-today writes without explicit `--date`). For tomorrow's daily, use `metalmind atium new --date tomorrow`. For action items, `metalmind atium add "<item>" --date <date>` is the canonical surface — not scribe.

**The promotion rule:** when a daily entry contains a reusable insight, *promote it* — copy it into a `Learnings/<topic>.md` and reference back. Daily notes age out of recall context faster than learnings; they're a lifelogging surface, not a knowledge base.

### `Inbox/` — transient triage bucket

**What goes here:** captures that need to be triaged but you don't know where they belong yet. Filename is whatever — `random-thought.md`, `2026-05-04-thing.md`.

**Anchors:** `kind: inbox`.

**Discipline:** Inbox files untouched >14 days are a triage prompt — `/save` will surface them. Triage means: move the file to the right folder (via `scribe rename`) or archive it. Inbox should not be a permanent home for anything.

### `Memory/` — model-managed context

**What goes here:** notes that an agent (typically `/save` or a custom skill) wrote on its own initiative. Migrated content from native Claude Code memory. Rarely written by hand.

**Anchors:** `kind: memory`.

**Discipline:** mostly read-only from the user side. Treat as "things Claude noticed about me/my preferences." Don't promote — let it accumulate; recall will surface it when relevant.

### `Personal/` — non-work

**What goes here:** anything not work-related. Reading notes, life decisions, side-project journals.

**Anchors:** `kind: personal`. No `project:` unless it's a personal project.

**Discipline:** kept separate from work for context-isolation — when you're in a work session and recall surfaces a personal note, that's the wrong shape.

### `Archive/` — shipped or superseded

**What goes here:** notes whose lifecycle is done. Shipped plans. Sunset projects. Old MOCs.

**Anchors:** `status: archived` (set automatically by `scribe archive` / `gold`). The original folder structure is preserved under `Archive/Plans/`, `Archive/Work/`, etc.

**Discipline:** archived ≠ deleted. Recall still searches `Archive/` (with rank penalty) — it answers the "why did we decide X in April?" question. Don't mass-delete; future-you will want the trail.

### The decision question

When you're about to write a note, ask:

1. **Is this a decision (durable) or a logbook entry (time-bound)?** Decision → `Plans/` / `Learnings/` / `Work/`. Logbook → `Daily/`.
2. **Is this insight project-specific or generalisable?** Project → `Work/`. Generalisable → `Learnings/`.
3. **Will I or another engineer benefit from this in a year?** If yes → write it well, link it from the MOC, give it real frontmatter. If no → maybe `Inbox/` for triage, or skip writing entirely.

If you can't answer the three questions in 30 seconds, the note isn't ready to write yet. Recall the topic first; the existing note (if any) tells you the shape.

---

## See also

- [`architecture.md`](architecture.md) — module overview + how the modules share state.
- Repo root [`README.md`](../README.md) — module list + comparison matrix.
- `metalmind --help` — full CLI reference.
- `metalmind scribe --help` / `metalmind atium --help` — vault-write specifics.
