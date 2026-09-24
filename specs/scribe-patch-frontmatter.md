# Spec: `scribe patch --frontmatter`

## Objective

No metalmind verb can edit frontmatter, and the vault rule forbids direct writes, so a note whose frontmatter does not parse (an unquoted `title:` with `: ` in it, a list item with a nested `key: value`) cannot be repaired at all. Six notes in the live vault are stuck this way and so also miss `type:`. Add a way to edit frontmatter text through metalmind.

## Functional Requirements

- WHERE `--frontmatter` is passed with `--find/--replace` THE SYSTEM SHALL search and replace inside the frontmatter block instead of the body.
- THE SYSTEM SHALL work on notes whose current frontmatter does not parse (that is the point).
- IF the frontmatter after the replacement does not parse as a YAML mapping, THEN THE SYSTEM SHALL write nothing and report the YAML error.
- IF the note has no frontmatter block, THEN THE SYSTEM SHALL refuse.
- IF `--find` matches more than once THE SYSTEM SHALL require `--occurrence`, as body find already does.
- WHERE `--dry-run` is passed THE SYSTEM SHALL write nothing, and still run the parse check so a dry run reports a bad replacement.
- WHEN the replacement is written THE SYSTEM SHALL bump `updated:`, as body find already does.
- IF `--frontmatter` is passed with `--section`, or without `--find`, THEN THE SYSTEM SHALL refuse.

## Boundaries

- Never: change body find/replace behaviour; touch the body in frontmatter mode.
- Ask first: live-vault edits (already approved for the six stuck notes, 2026-09-24).

## Commands, structure, testing

Same as `specs/tolaria-compatibility.md`: `pnpm --filter metalmind test|typecheck|build`, `pnpm exec biome check cli/src`. Code in `cli/src/scribe/scribe.ts`, `cli/src/commands/scribe.ts`, `cli/src/cli.ts`; vitest tests in `cli/src/scribe/scribe.test.ts`.

## Success Criteria

- The six stuck notes parse after one `scribe patch --frontmatter` each, `scribe backfill-type` then adds `type:` to all six, and a rerun changes nothing.
- Tests, typecheck, lint and build pass.

## Clarifications

- A `--frontmatter` flag on `patch` rather than a new `set <key> <value>` verb: one of the six breaks inside a `revisions:` list item, which a key setter cannot address (decided 2026-09-24, user chose "add a metalmind command").
