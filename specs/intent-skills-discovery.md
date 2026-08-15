# Spec: Intent skills discovery

## Objective

TanStack Intent lets a package ship `SKILL.md` guidance that travels with it through npm, so an agent working in a repo can learn the library's own conventions instead of guessing from training data. Adoption is real: Agent Skills is an Anthropic open standard, 16+ tools consume it, and Vercel, Prisma, Supabase and Stripe ship official skills.

metalmind's forge already knows which repos you work across. This adds one informational `doctor` check that reports how much of that procedural knowledge is sitting unused in your dependency graphs. It surfaces availability and nothing else - it copies no content, asserts no configuration, and cannot fail.

The division of labour it assumes: **Intent supplies the library's procedural knowledge; metalmind holds the decisions you authored.** The check exists to point at the former, not to absorb it.

## Functional Requirements

- WHEN `doctor` runs its deep checks, THE SYSTEM SHALL include an `intent-skills` check covering every repo registered in any forge group.
- THE SYSTEM SHALL report the check as `ok: true` in all cases, including every failure mode.
- WHEN a repo's dependency graph exposes Intent skills, THE SYSTEM SHALL report the total skill count, the package count, and up to three repo names with their contributing packages.
- IF no forge group contains any repo, THEN THE SYSTEM SHALL report that no forge repos are registered and run no subprocess.
- IF a repo exposes no intent-enabled dependencies, THEN THE SYSTEM SHALL count it as scanned and contribute nothing to the totals.
- IF `<repo>/node_modules/.bin/intent` does not exist, THEN THE SYSTEM SHALL treat that repo as unavailable without spawning a subprocess, and SHALL NOT install anything.
- IF every scanned repo is unavailable, THEN THE SYSTEM SHALL report that the Intent CLI was not available and that the check was skipped.
- IF the CLI emits output that does not parse as JSON, THEN THE SYSTEM SHALL treat that repo as unavailable.
- IF a repo scan exceeds 2 seconds, THEN THE SYSTEM SHALL abandon that repo and continue with the rest.
- IF the run exceeds a shared 10-second budget, THEN THE SYSTEM SHALL stop scanning and report from the repos already scanned.
- IF a registered repo path does not exist, THEN THE SYSTEM SHALL skip it without a subprocess.

## Tech Stack

TypeScript CLI (`cli/`), vitest. Shells `npx` via the existing `runCommand`. No new dependencies. No Python change. The Intent CLI itself is never a metalmind dependency - it is used only when a repo already resolves it.

## Commands

- Build: `cd cli && pnpm build`
- Test: `cd cli && pnpm test`
- Targeted: `cd cli && pnpm exec vitest run src/intent/intent.test.ts`
- Lint: `cd cli && pnpm exec biome check --write src/`
- Manual: `node cli/dist/cli.js doctor --deep`

## Project Structure

- `cli/src/intent/intent.ts` - new: `listIntentSkills`, `scanForgeIntentSkills`, result types
- `cli/src/intent/intent.test.ts` - new: unit tests with `runCommand` mocked
- `cli/src/commands/doctor.ts` - `checkIntentSkills`, wired into `runDeepChecks`
- `cli/src/commands/doctor.test.ts` - check-level tests
- Docs: `docs/architecture.md` (health module), `docs/cookbook.md` (the division of labour with Intent)

## Code Style

Mirrors `coderefs.ts`: statuses over exceptions, bounded subprocesses, a shared deadline threaded through the run.

```ts
export interface RepoIntentSkills {
  repo: string;
  status: 'ok' | 'unavailable';
  packages: Array<{ name: string; skills: string[] }>;
}
```

Invocation resolves the repo's own binary at `<repo>/node_modules/.bin/intent` and runs `list --json` with `cwd` set to the repo. This replaces the originally-specified `npx --no-install`, which verification proved unusable: npm aborts with `EBADDEVENGINES` in any project declaring `packageManager: pnpm`, which is most repos here. Resolving the binary directly is also strictly safer - a repo without Intent has no binary, so there is nothing to run and nothing to install.

## Testing Strategy

Vitest with `runCommand` mocked, as `doctor.test.ts` already does. Cases: well-formed JSON parsed into counts; a repo with an empty dependency graph; non-zero exit (CLI absent) treated as unavailable; malformed JSON treated as unavailable; a timeout in one repo leaving the others reported; no forge groups short-circuiting with no subprocess; and a check-level test asserting `ok` stays true when every repo fails.

Parser tests drive off a fixture of the real `intent list --json` output captured during the verification task below, not an invented shape.

## Boundaries

- Always: keep the check informational; bound every subprocess; treat all failures as `unavailable`; resolve the repo-local binary rather than a package runner.
- Ask first: making the check fail on anything; running any Intent command other than `list`; adding `@tanstack/intent` as a dependency.
- Never: copy skill content into the vault; write to any forge repo; install a package as a side effect of a health check.

## Success Criteria

- `doctor --deep` on a machine with no Intent-enabled repos prints one informational line and adds no meaningful latency.
- With a repo that does expose skills, the line names the repo and its contributing packages.
- Killing the Intent CLI, corrupting its output, or pointing a forge group at a deleted path all leave `doctor` green and the other checks unaffected.
- Every EARS line above has a covering test.

## Clarifications

- Direction: `doctor` check only. Ingesting skills into the vault was rejected in brainstorm - Intent's value is that skills are versioned with the package, and a vault copy would freeze them at import time, manufacturing the exact staleness Intent exists to prevent (user decision, 2026-08-06).
- Assertion: availability only. Failing a repo for not wiring skills into its agent config would be metalmind overruling a deliberate setup choice (user decision, 2026-08-06).
- `intent stale` is out of scope: it is a maintainer-side command, so against third-party dependencies it would mostly report drift the user cannot act on.
- metalmind shipping its own skills via Intent is deferred; it overlaps the stamping model that is currently metalmind's distribution story.

## Open Questions

**Resolved 2026-08-06.** The schema was captured from a real run and committed at `cli/src/intent/__fixtures__/intent-list.json`: a top-level object with `skills[]`, `packages[]`, `hiddenSourceCount`, `hiddenSources[]`, `warnings[]`, `notices[]`, `conflicts[]`. Each package carries `{name, version, source, packageRoot, skillCount}`; each skill carries `{use, packageName, packageRoot, packageVersion, packageSource, skillName, description}`.

Verification also invalidated the planned invocation - see Code Style. No open questions remain.
