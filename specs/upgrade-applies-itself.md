# Spec: an upgrade applies itself, and the watcher catches up

## Objective

Tested on clean Linux containers (2026-09-24): a first install of 0.28.3 lands in the current state, but `pnpm add -g metalmind@<new>` over an older install changes nothing until the user runs `metalmind stamp`, and nothing tells them to. Older notes keep lacking `type:` even after a stamp, silently. Separately, the watcher never indexes notes that changed while it was stopped, and `init` ignores every `--no-…` flag. After this release an upgrade needs one command, `pnpm add -g metalmind@<new>`, and the next metalmind command brings the install to that version.

## Functional Requirements

`init` flags:

- WHEN `init` gets `--no-serena`, `--no-teams`, `--no-eod-hook`, `--no-notifications`, `--no-git` or `--no-auto-install-uv` THE SYSTEM SHALL treat that option as off, with or without `--yes`.

Auto-stamp:

- WHEN `stamp` or `init` completes THE SYSTEM SHALL record the CLI version in `~/.metalmind/stamped-version`.
- WHEN any other metalmind command runs on an initialised install whose recorded version differs from the running CLI version, or has none recorded, THE SYSTEM SHALL first run `metalmind stamp --no-prompt` once, in a child process, with its output going to `~/.metalmind/logs/auto-stamp.log`, and print one line to stderr naming the version and the log.
- THE SYSTEM SHALL not auto-stamp for `init`, `stamp`, `burn brass` or `uninstall`, before `init` has ever run, or while `METALMIND_NO_AUTO_STAMP=1`.
- IF the auto-stamp fails THE SYSTEM SHALL print one stderr line telling the user to run `metalmind stamp`, and still run the command they asked for.
- WHILE one auto-stamp is running THE SYSTEM SHALL not start a second (lock directory `~/.metalmind/auto-stamp.lock`, treated as stale after 10 minutes).
- The command's own stdout SHALL be unchanged by an auto-stamp (so `--json` output stays clean).

Hints, not rewrites:

- WHEN `stamp` finishes and notes carry `kind:` without `type:` THE SYSTEM SHALL print the count and `metalmind scribe backfill-type`.
- `doctor --deep` SHALL report: the recorded stamp version against the CLI version; whether `<vault>/AGENTS.md` carries the managed block; how many notes lack `type:`. Each with its remediation. None of them fails the run.

Watcher catch-up (metalmind-vault-rag):

- WHEN the watcher starts on a populated index THE SYSTEM SHALL reindex every vault note that is not in the index or was modified after the index was last written, and remove index entries for notes no longer on disk.
- IF nothing changed THE SYSTEM SHALL do no indexing work.

## Boundaries

- Never: rewrite vault notes during an auto-stamp or a stamp (hints only, user decision 2026-09-24); write to stdout from the auto-stamp path.
- Ask first: publishing, installing on the laptop and mikihome (already requested by the user for this release).

## Commands, structure, testing

`pnpm --filter metalmind test|typecheck|build`, `pnpm exec biome check cli/src`, `pnpm test:python` (pytest for `packages/vault-rag`). CLI: `cli/src/commands/init.ts`, `cli/src/commands/stamp.ts`, `cli/src/commands/doctor.ts`, `cli/src/install/auto-stamp.ts` (new), `cli/src/cli.ts`. Watcher: `packages/vault-rag/metalmind_vault_rag/watcher.py`. Tests beside each.

End-to-end check: the container harness in `/tmp/mm-install-test` (fresh install, and 0.27.1 upgraded with `pnpm add -g` and one plain command, no manual stamp).

## Success Criteria

- Upgrade harness: after `pnpm add -g metalmind@<new>` and one `metalmind scribe list`, the vault has `AGENTS.md` with the Tolaria section and `stamped-version` equals the new version, with no manual `stamp`.
- Fresh harness: `--no-serena --no-git` installs neither Serena nor a vault git repo.
- A note written while the watcher is stopped is found by recall after the watcher starts.

## Clarifications

- Auto-stamp once rather than a notice; hints only for `type:` (user, 2026-09-24).
