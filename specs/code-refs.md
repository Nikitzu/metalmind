# Spec: Code-aware memory validation (code refs)

## Objective

Vault notes record decisions about code, and the code moves on. A note can name the exact function it governs, yet recall serves it years after that function is deleted, with no signal that the claim went stale. This feature lets notes carry machine-checkable code references (`code: ["repo#symbol"]` in frontmatter) and validates them on demand: `metalmind tap copper --verify-code` annotates hits whose references no longer resolve, and `metalmind doctor` gains a vault-wide integrity check. No memory tool does this; it turns "the note says X" into "the note says X and the code it points at still exists."

Resolution is deliberately cheap: repo names resolve through the existing forge registry, symbols are checked with a definition-shaped ripgrep/grep search. No new dependencies, no LSP, no index. TypeScript only - the Python retrieval layer is untouched.

## Functional Requirements

Reference shape and authoring:

- THE SYSTEM SHALL read code references from a `code:` frontmatter list where each entry is `<repo>#<symbol>`, `<repo>` matching the basename of a repo path registered in any forge group and `<symbol>` a plain identifier (`[A-Za-z_$][A-Za-z0-9_$]*`).
- WHEN `scribe create` or `scribe update` is invoked with `--code <csv>`, THE SYSTEM SHALL stamp the parsed list into the note's `code:` frontmatter field.
- IF a `--code` entry does not match the `<repo>#<symbol>` shape, THEN THE SYSTEM SHALL refuse with an error naming the malformed entry, and write nothing.

Resolution:

- WHEN a reference's `<repo>` matches the basename of a registered repo path, THE SYSTEM SHALL search that repo for `<symbol>` as a definition-shaped occurrence (declaration keywords across common languages, with an assignment/callable fallback), using ripgrep when available and grep otherwise, skipping `node_modules`, `.git`, `dist`, `build`, `target`, `.venv`.
- IF `<repo>` matches no registered repo path basename, THEN THE SYSTEM SHALL report the reference as `unresolvable-repo`.
- IF the symbol search finds no occurrence, THEN THE SYSTEM SHALL report `missing`; otherwise `ok`.
- IF a repo search exceeds 2 seconds, or total verification exceeds 10 seconds, THEN THE SYSTEM SHALL report the affected references as `unresolvable-repo` with a timeout detail rather than blocking.

Recall annotation:

- WHEN `tap copper` runs with `--verify-code`, THE SYSTEM SHALL read each hit note's frontmatter head, validate its code references, and append a warning to the rendered hit line for every non-`ok` reference (`⚠ code ref missing: repo#symbol`).
- WHERE `--json` is combined with `--verify-code`, THE SYSTEM SHALL attach `code_refs: [{ref, status}]` to each hit that has references.
- WHILE `--verify-code` is absent, THE SYSTEM SHALL perform no code-reference work during recall.

Doctor:

- WHEN `doctor` runs its deep checks, THE SYSTEM SHALL include a `code-refs-integrity` check that walks vault frontmatter, validates every reference, and reports `ok` when all resolve or a detail naming up to five offenders (with a `+N more` overflow) and a remediation line otherwise.

## Tech Stack

TypeScript CLI (`cli/`): commander, clack, vitest. Shells out to `rg` (optional) or `grep`. No new dependencies. No Python change.

## Commands

- Build: `cd cli && pnpm build`
- Test: `cd cli && pnpm test`
- Targeted: `cd cli && pnpm exec vitest run src/coderefs/coderefs.test.ts`
- Lint: `cd cli && pnpm exec biome check --write src/`

## Project Structure

- `cli/src/coderefs/coderefs.ts` - new module: `parseCodeRefs`, `resolveRepoPath`, `checkSymbol`, `verifyCodeRefs` (per-note orchestration)
- `cli/src/coderefs/coderefs.test.ts` - unit tests against temp fake repos
- `cli/src/backends/recall.ts` - `--verify-code` annotation after hits return (both transports share the formatting path)
- `cli/src/commands/tap.ts` + `cli/src/cli.ts` - flag wiring
- `cli/src/commands/doctor.ts` + `doctor.test.ts` - `checkCodeRefsIntegrity`
- `cli/src/scribe/scribe.ts` + `commands/scribe.ts` + `cli.ts` - `--code` stamping
- Docs: `cli/templates/claude/skills/metalmind-cli/SKILL.md`, `README.md`, `docs/architecture.md`

## Code Style

Follow the shipped supersede pattern: small pure helpers, result objects, docstrings carrying the why. Example shape:

```ts
export type CodeRefStatus = 'ok' | 'missing' | 'unresolvable-repo';

export interface CodeRefResult {
  ref: string;
  status: CodeRefStatus;
  detail?: string;
}
```

## Testing Strategy

Vitest. Unit tests for `parseCodeRefs` (valid list, malformed entries, absent field), `resolveRepoPath` (basename match across groups, unknown repo, ambiguous basename determinism), `checkSymbol` against a temp directory containing definition-shaped and mention-only files (both rg and grep paths, forced via an injection seam), timeout behavior with an artificial slow command. Doctor test in the existing `checkSupersedeIntegrity` shape with a temp vault + temp repo. Recall test with mocked fetch returning hits pointing at temp vault notes carrying `code:` refs.

## Boundaries

- Always: run both suites before commit; keep verification opt-in on the recall path; treat resolver failures as statuses, never thrown errors that break recall output.
- Ask first: new dependencies; any Python/vault-rag change; validating at recall time by default.
- Never: mutate note frontmatter during validation; let a slow/hung repo search block recall past the cap; report a mention-only occurrence as a definition when the definition pattern found nothing.

## Success Criteria

- A note stamped `code: ["metalmind#resolveNotePath"]` reports `ok` while the symbol exists and `missing` after it is renamed, via both `tap copper --verify-code` and `doctor`.
- A ref naming an unregistered repo reports `unresolvable-repo`, not an error.
- Recall latency without `--verify-code` is unchanged (no code-ref work performed).
- All existing tests stay green; every EARS line above has a covering test.

## Clarifications

- Resolver: forge-registry + rg/grep, not Serena, not codegraph (user decision, 2026-08-05).
- Timing: doctor + opt-in `--verify-code` tap flag, never default-on at recall (user decision, 2026-08-05).
- Ref shape: `code: ["repo#symbol"]` list, no file paths (user decision, 2026-08-05).
- Assumptions 1-5 (identifier-only symbols, basename resolution with deterministic first-match, three statuses only, 2s/10s timeouts, shape-only authoring validation) accepted 2026-08-05.

## Open Questions

None blocking. Deferred: rename/moved detection, caller tracking (waits for the codegraph decision), symbol existence check at authoring time.
