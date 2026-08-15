# Spec: Temporal supersedes (scribe supersede + recall downweight)

## Objective

Decisions in the vault change over time, but old notes keep outranking their replacements because recall has no notion of "this was true, and then it wasn't." This feature adds an explicit supersede relationship between notes: `metalmind scribe supersede <old> <new>` marks the old note superseded and points it at its successor, and recall downweights superseded notes while carrying a pointer to the current one in every hit. History is never deleted or hidden - it re-ranks below current truth and tells the reader where truth moved.

This is the top-ranked differentiator from the 2026-08-04 analyzer review: supersede-not-delete is where the temporal-memory landscape (Graphiti/Zep, temporal-KG work) is converging, and it is unreachable for Claude Code native auto memory. Validity windows and `--as-of` time-travel queries are explicitly deferred until supersede chains exist in real use.

## Functional Requirements

CLI:

- WHEN `scribe supersede <old> <new>` is invoked and both notes exist, THE SYSTEM SHALL set `status: superseded` and `superseded_by: <new-stem>` in the old note's frontmatter, set `supersedes: <old-stem>` in the new note's frontmatter, and bump `updated:` on both.
- IF `<old>` or `<new>` does not resolve to an existing note, THEN THE SYSTEM SHALL exit non-zero naming the missing note and write nothing.
- IF `<old>` and `<new>` resolve to the same file, THEN THE SYSTEM SHALL refuse with a self-supersede error.
- IF the old note already has `superseded_by` and `--force` is absent, THEN THE SYSTEM SHALL refuse, naming the existing successor.
- IF the old note already has `superseded_by` and `--force` is present, THEN THE SYSTEM SHALL re-point `superseded_by` to the new successor and stamp `supersedes` on it.
- WHEN `--dry-run` is passed, THE SYSTEM SHALL report both intended frontmatter changes and write nothing.
- IF either note is a daily note for a non-today date, THEN THE SYSTEM SHALL require the `--date` acknowledgement (existing `assertDailyDateAck` contract).
- THE SYSTEM SHALL expose the verb under both command groups (`scribe supersede`, `note supersede`).

Recall:

- WHEN a hit's source note has `status: superseded`, THE SYSTEM SHALL multiply its fused score by the supersede penalty (default 0.4) in `_rrf_merge`, stacking multiplicatively with folder penalties.
- WHEN a hit's source note has `superseded_by`, THE SYSTEM SHALL include `superseded_by: <stem>` in the hit payload on both the HTTP and stdio MCP paths.
- WHERE `METALMIND_SUPERSEDE_PENALTY` is set, THE SYSTEM SHALL use its float value as the multiplier instead of 0.4.
- WHILE the vault is unchanged (file count and max mtime stable), THE SYSTEM SHALL serve the supersede map from the process-lifetime cache without re-walking the vault.
- IF `superseded_by` names a stem that no longer resolves, THEN THE SYSTEM SHALL still downweight and pass the stem through unmodified (no error, no resolution attempt).

## Tech Stack

- TypeScript CLI: commander + clack, vitest (`cli/`)
- Python retrieval: `metalmind_vault_rag` (`packages/vault-rag/`), pytest via `uv run --extra dev`
- No new dependencies.

## Commands

- Build: `cd cli && pnpm build`
- CLI tests: `cd cli && pnpm test`
- Python tests: `cd packages/vault-rag && uv run --extra dev pytest tests/`
- Lint: `cd cli && pnpm exec biome check --write src/`
- Bench (no-regression gate): `node bench/recall-v0/run.mjs --scales 12`

## Project Structure

- `cli/src/scribe/scribe.ts` - `scribeSupersede()` core (reuses `resolveNotePath`, `rewriteFrontmatterField`, `assertDailyDateAck`, `exists`)
- `cli/src/commands/scribe.ts` - `scribeSupersedeCmd()` command layer
- `cli/src/cli.ts` - option wiring in `attachScribeSubcommands` (covers both `scribe` and `note` groups)
- `cli/src/scribe/scribe.test.ts` - CLI tests
- `packages/vault-rag/metalmind_vault_rag/search.py` - `_supersede_index()` + penalty in `_rrf_merge` + payload passthrough
- `packages/vault-rag/tests/test_supersede.py` - Python tests
- Docs: `cli/templates/claude/skills/metalmind-cli/SKILL.md`, `cli/templates/.shared/save-body.md` (Scadrial|Classic table row), `README.md` verb list, `docs/architecture.md` recall bullet

## Code Style

Match the shipped folder-penalty pattern - module-level constant with env override, small pure helper, docstring carries the why:

```python
SUPERSEDE_PENALTY = float(os.environ.get("METALMIND_SUPERSEDE_PENALTY", "0.4"))
```

TypeScript follows the existing scribe verb shape: core function in `scribe.ts` returning a result object, thin command wrapper doing stdin/log/fail handling.

## Testing Strategy

- CLI (vitest, `scribe.test.ts` shape): happy path stamps both notes, missing old, missing new, self-supersede, already-superseded refusal, `--force` re-point, `--dry-run` writes nothing, daily-date guard, `updated:` bumped on both.
- Python (pytest, `test_folder_penalty.py` shape): map built from frontmatter, superseded hit scores below equal active hit, penalty stacks with folder penalty, `superseded_by` present in hit payload, dangling stem passes through, env override respected, cache invalidates on mtime change.
- Bench: `recall-v0` run at parity (fixture vault has no superseded notes; gate is no regression).

## Boundaries

- Always: run both suites before commit; `--dry-run` parity on the new verb; frontmatter edits only via `rewriteFrontmatterField`.
- Ask first: any index/schema change (design explicitly avoids one); adding a top-level metal shortcut (malatium) for supersede; MOC-link changes on supersede.
- Never: delete or rewrite note bodies; hide superseded notes from results entirely; break the stdio MCP path's payload parity with HTTP.

## Success Criteria

- `metalmind scribe supersede plan:old plan:new` stamps both notes and is idempotent-refusing on repeat without `--force`.
- A query matching a superseded note ranks the successor (or any equal-relevance active note) above it, and the superseded hit's payload names its successor.
- All existing tests stay green; new tests cover every EARS line above.
- `recall-v0` bench shows no regression.

## Clarifications

- Scope: supersede + downweight only; validity windows and `--as-of` deferred (user decision, 2026-08-05).
- Recall UX: downweight + pointer, never replace or hide (user decision, 2026-08-05).
- New note must already exist; no inline creation, no successor-less supersede (user decision, 2026-08-05).
- Query-time frontmatter map (approach A) over index-time payloads or CLI post-processing (user decision, 2026-08-05).
- Both command flavors covered via the shared subcommand attach; no dedicated metal shortcut this iteration (user decision, 2026-08-05).

## Open Questions

None blocking. Deferred explicitly: `doctor` check for dangling supersede pointers, malatium shortcut, validity windows, `--as-of` queries.
