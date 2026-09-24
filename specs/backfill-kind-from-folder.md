# Spec: `scribe backfill-type --from-folder`

## Objective

`backfill-type` copies an existing `kind:` into `type:`, so notes written before scribe stamped `kind:` stay untyped in Tolaria. The live vault has 37 of them: 35 with frontmatter but no `kind:`, and 2 with no frontmatter at all. Their folder already says what they are.

## Functional Requirements

- WHERE `--from-folder` is passed THE SYSTEM SHALL give every note that has neither `kind:` nor `type:` the kind of its folder, written as both `kind:` and `type:`.
- THE SYSTEM SHALL map folders through the existing kind-to-folder table, longest match first (`Work/MOCs` is `moc`, not `work`), and SHALL read `Archive/<folder>/` as `<folder>/`.
- IF the note has parseable frontmatter THE SYSTEM SHALL add the two lines at the end of the block and leave every other byte unchanged.
- IF the note has no frontmatter THE SYSTEM SHALL prepend a block holding only those two lines.
- IF the folder maps to no kind, or the frontmatter does not parse, THEN THE SYSTEM SHALL skip the note and list it.
- A note that already has `type:` SHALL be left alone; a note with `kind:` and no `type:` SHALL still get `type:` as today.
- WHERE `--dry-run` is passed THE SYSTEM SHALL write nothing and list each note with the kind it would get.
- WHEN run a second time THE SYSTEM SHALL change nothing.
- `doctor --deep` and `stamp` SHALL also count notes with no `kind:` and name `metalmind scribe backfill-type --from-folder`.

## Boundaries

- Never: change how `backfill-type` behaves without the flag; guess a kind for a folder outside the table.

## Commands, structure, testing

`pnpm --filter metalmind test|typecheck|build`, `pnpm exec biome check cli/src`. Code in `cli/src/scribe/scribe.ts`, `cli/src/commands/scribe.ts`, `cli/src/cli.ts`, `cli/src/commands/doctor.ts`, `cli/src/commands/stamp.ts`; tests beside them.

## Success Criteria

- On the live vault the dry run lists all 37 notes with the expected kinds (13 plan, 12 work under Archive; 4 moc; 4 learning; 4 work), the real run adds exactly those lines, and Tolaria then shows no untyped note apart from `CLAUDE.md` and `AGENTS.md`.
