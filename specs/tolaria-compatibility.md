# Spec: Tolaria compatibility

## Objective

Let one metalmind vault be opened in either Obsidian or Tolaria with no setting to flip. Tolaria groups notes by the `type:` frontmatter key and ignores `kind:`, so today every metalmind note shows as untyped there. Obsidian ignores `type:`, so writing both keys costs nothing on that side.

Tolaria also surfaces a vault-root `AGENTS.md` to connected agents, and its MCP ships write tools (`create_note`, `update_note`, `append_to_note`) that bypass metalmind. The vault rules metalmind already stamps into `<vault>/CLAUDE.md` need to reach those agents too.

User: a metalmind user who opens the vault in Tolaria, Obsidian, or both.

## Functional Requirements

Frontmatter on write:

- WHEN `scribe create` writes a note THE SYSTEM SHALL emit `type: <kind>` directly after `kind: <kind>`.
- WHEN a MOC is auto-created THE SYSTEM SHALL emit `type: moc` alongside `kind: moc`.
- WHEN `ingest auto-memory` writes a note THE SYSTEM SHALL emit `type: memory` alongside `kind: memory`.
- IF a note being updated, patched or renamed already has frontmatter THE SYSTEM SHALL leave its `type:` value untouched (existing behaviour, asserted by test).

Backfill:

- WHEN `metalmind scribe backfill-type` runs THE SYSTEM SHALL add `type: <kind>` to every vault `.md` note that has `kind:` and no `type:`.
- IF a note already has `type:` THE SYSTEM SHALL skip it, whatever the value (the 18 `type: feedback` notes stay as they are).
- IF a note has no `kind:` or no frontmatter THE SYSTEM SHALL skip it.
- THE SYSTEM SHALL change nothing in a backfilled file except inserting that one line: no `updated:` bump, no reflow, no other key touched.
- WHERE `--dry-run` is passed THE SYSTEM SHALL write nothing and print the count and paths it would change.
- THE SYSTEM SHALL skip `.obsidian/`, `.git/`, `.trash/`, `.metalmind-stack/` and `node_modules/`, matching the existing vault walkers.
- WHEN run a second time THE SYSTEM SHALL change zero files.

AGENTS.md:

- WHEN `stamp` or `init` sets up the vault THE SYSTEM SHALL upsert the same rendered sentinel block it writes to `<vault>/CLAUDE.md` into `<vault>/AGENTS.md`.
- THE SYSTEM SHALL preserve any content outside the sentinel markers in `AGENTS.md`.
- WHEN `uninstall` runs THE SYSTEM SHALL remove the `AGENTS.md` block and delete the file if the block was its only content.
- The shared template SHALL name Tolaria's MCP write tools as covered by the never-raw-write rule, and SHALL list `type:` next to `kind:` in the frontmatter conventions.

Doctor:

- WHEN `doctor` runs THE SYSTEM SHALL report Tolaria as detected or not detected, with an install hint, alongside the existing Obsidian line. Neither result is a failure.

## Tech Stack

TypeScript CLI in `cli/`, Node ≥ 20, pnpm workspaces, commander, vitest, Biome. No new dependencies. No change to `packages/vault-rag` (it does not read `type:`).

## Commands

```
Test:      pnpm --filter metalmind test
Typecheck: pnpm --filter metalmind typecheck
Lint:      pnpm exec biome check cli/src
Build:     pnpm --filter metalmind build
Try it:    pnpm --filter metalmind dev scribe backfill-type --dry-run
```

## Project Structure

```
cli/src/scribe/scribe.ts          create + MOC frontmatter, new backfillType()
cli/src/commands/scribe.ts        wires the backfill-type verb
cli/src/commands/ingest.ts        auto-memory frontmatter
cli/src/install/vault.ts          setupVault also upserts AGENTS.md
cli/src/install/teardown.ts       uninstall removes the AGENTS.md block
cli/templates/vault/CLAUDE.md.block.template   shared vault block text
cli/src/util/tolaria.ts           detectTolaria(), mirrors util/obsidian.ts
cli/src/commands/doctor.ts        prints the Tolaria line
Tests sit next to each file as *.test.ts
```

## Code Style

Match the surrounding code: small named functions, `node:` imports, no new abstractions. Frontmatter goes through the existing `buildFrontmatter`; the backfill inserts one line and does not re-serialise the block.

```ts
const frontmatter = buildFrontmatter({
  project: opts.project,
  kind: opts.kind,
  type: opts.kind,
  title: opts.title,
  // ...
});
```

## Testing Strategy

vitest unit tests beside the code, TDD per task:

- create, MOC auto-create and ingest emit `type:` equal to `kind:`
- backfill: adds the line; skips existing `type:`; skips no-kind and no-frontmatter files; byte-identical apart from the inserted line; dry-run writes nothing; second run changes zero files; skipped directories stay untouched
- setupVault writes both files; content outside the sentinels survives; teardown removes the block and deletes an otherwise empty file
- detectTolaria found and not-found paths

Final check against a copy of the real vault (`cp -R ~/Knowledge /tmp/vault-copy`), never the live vault, before the real run.

## Boundaries

- Always: sentinel-bounded writes into user-owned files; `--dry-run` on the new mutating verb; tests before each commit.
- Ask first: running the backfill on the live `~/Knowledge` vault; publishing a release; any change to recall or the watcher.
- Never: rewrite or drop `kind:` (recall filters and folder routing depend on it); touch `.obsidian/`; remove the `kanban-plugin` key from `Work/board.md`; add a Tolaria dependency or call its MCP from metalmind.

## Success Criteria

- A note created by `scribe create` opens in Tolaria with its type set.
- On a copy of the real vault, the backfill dry-run reports roughly 430 to 450 files, and the real run leaves every file's diff at exactly one added line.
- Tolaria's `get_vault_context` for `~/Knowledge` returns `agentInstructions` that are not null after `stamp`, and the note types show metalmind kinds instead of null.
- Test, typecheck and lint pass.

## Clarifications

All answered by the user on 2026-09-24.

- Editor mode: always write both keys, no setting.
- Backfill lives in its own verb, `metalmind scribe backfill-type`, not in `doctor --fix`.
- Inbox captures written by `saveToVault` stay untyped. Out of scope.
- The watcher re-embeds the backfilled files on its own. No pause and no manual rebuild.
