# Spec: Auto-memory ingest

## Objective

Claude Code's native auto memory accumulates topic files under `~/.claude/projects/<project>/memory/` that metalmind's recall cannot see. `metalmind ingest auto-memory` imports them into the vault as first-class `Memory/` notes - recallable, supersedable, synced - turning the native memory system into a feeder instead of a competitor. Re-runs are idempotent and never destroy local edits.

## Functional Requirements

- WHEN `ingest auto-memory` runs, THE SYSTEM SHALL scan `~/.claude/projects/*/memory/*.md` (top level only), excluding each directory's `MEMORY.md` index file and empty files.
- WHEN a source file has no corresponding vault note, THE SYSTEM SHALL create `Memory/auto-<project-slug>-<topic-slug>.md` whose body is the source content verbatim, with frontmatter carrying `kind: memory`, `tags: ["auto-memory"]`, `source_path`, `imported_hash` (sha1 of the body as written), and created/updated dates.
- IF the vault note exists and the source content's hash equals the note's `imported_hash`, THEN THE SYSTEM SHALL skip it.
- IF the source changed and the note body still hashes to `imported_hash`, THEN THE SYSTEM SHALL overwrite the body, update `imported_hash` and `updated:`.
- IF the source changed and the note body no longer hashes to `imported_hash`, THEN THE SYSTEM SHALL skip with a conflict warning naming both paths, and write nothing.
- WHEN `--dry-run` is passed, THE SYSTEM SHALL report every intended action and write nothing.
- WHEN the run finishes, THE SYSTEM SHALL report counts: created, updated, skipped, conflicts.
- IF `~/.claude/projects/` does not exist or contains no memory files, THEN THE SYSTEM SHALL report that and exit zero.

## Tech Stack

TypeScript CLI only. `node:crypto` sha1. No new dependencies, no Python change.

## Commands

- Build: `cd cli && pnpm build`
- Test: `cd cli && pnpm exec vitest run src/commands/ingest.test.ts`
- Full: `cd cli && pnpm test`

## Project Structure

- `cli/src/commands/ingest.ts` - scanner, hasher, importer, report (new)
- `cli/src/commands/ingest.test.ts` - tests with temp projects dir + temp vault (new)
- `cli/src/cli.ts` - `ingest auto-memory` command registration
- Docs: `cli/templates/claude/skills/metalmind-cli/SKILL.md`, `README.md`, `docs/architecture.md`

## Code Style

Follows the scribe result-object pattern. Bodies are written with scribe's `buildFrontmatter` (exported for this) rather than `scribeCreate`, because the body must stay byte-identical to the source for the hash contract - no injected `# title` heading.

```ts
export interface IngestResult {
  created: string[];
  updated: string[];
  skipped: string[];
  conflicts: string[];
}
```

## Testing Strategy

Vitest, temp dirs, injected paths (`projectsDir`, `vaultRoot`). Cases: fresh import creates with correct slug/frontmatter/body; unchanged source skips; changed source + unedited note overwrites and re-hashes; changed source + edited note conflicts and leaves the note untouched; `MEMORY.md` and empty files excluded; `--dry-run` writes nothing; missing projects dir reports cleanly.

## Boundaries

- Always: write through the scribe frontmatter machinery; preserve local edits (conflict wins over overwrite); run full suite before commit.
- Ask first: deleting vault notes whose source disappeared; watching/daemonizing the ingest.
- Never: modify the source files under `~/.claude/projects/`; import `MEMORY.md` index files; overwrite a locally-edited note.

## Success Criteria

- Running twice in a row: second run reports all-skipped, zero writes.
- Editing a vault copy then re-running with a changed source: conflict reported, note untouched.
- Imported notes surface in `tap copper` after the watcher's next reindex with no extra steps.
- All suites green; every EARS line has a covering test.

## Clarifications

- Import-into-vault over index-in-place or query-time merge (user decision, 2026-08-05).
- `Memory/` placement, overwrite-on-change with conflict protection (user decision, 2026-08-05).
- Project slug = projects dirname, leading `-` stripped, slugified; topic slug = filename stem slugified. Deterministic, collision-free across projects.
- Source deletions do not delete vault notes (ask-first boundary).

## Open Questions

None blocking. Deferred: scadrial metal alias for `ingest`; scheduled/hook-driven ingest.
