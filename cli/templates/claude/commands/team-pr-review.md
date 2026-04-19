---
description: Spawn a 4-reviewer agent team to parallel-review a PR (security, api-contract, performance, conventions).
argument-hint: <pr-url-or-branch> [--a11y]
---

You are about to create an agent team for parallel code review.

**Target:** `$ARGUMENTS` (a PR URL, a branch name, or a description of a diff to review)

**Steps:**

1. Fetch the diff:
   - If the target looks like a GitHub PR URL, use `gh pr view --json ... $ARGUMENTS` and `gh pr diff $ARGUMENTS`.
   - If the target is a branch, use `git diff main...$ARGUMENTS` (or the repo's default branch).
   - If the target is a description, ask the user for a concrete diff source before proceeding.

2. Create an agent team with these teammates, each given the full diff as part of its spawn prompt:
   - `security-reviewer` — Opus, high effort. Audit per `~/.claude/rules/security-boundaries.md`.
   - `api-contract-reviewer` — Opus, medium effort. Audit per `~/.claude/rules/api-design.md`.
   - `performance-reviewer` — Sonnet, medium effort.
   - `conventions-reviewer` — Sonnet, low effort.
   - Only if `--a11y` is in the arguments: add `a11y-reviewer` — Sonnet, low effort.

3. Each reviewer reports independently to you in its own output format. Do not have reviewers talk to each other — reviews should stay independent to avoid anchoring bias.

4. When all reviewers have finished, produce a **consolidated report** for the user with the following structure:

   ```
   ## Consolidated PR review: <pr ref>
   
   ### Critical (must fix before merge)
   - [security] file:line — title — suggested fix
   - [api-contract] file:line — title — suggested fix
   
   ### Should fix
   - [performance] file:line — title — suggested fix
   - [conventions] file:line — title — suggested fix
   
   ### Suggestions
   - ...
   
   ### Totals
   Security: N critical, M high, P medium, Q low
   API contract: N breaking, M widening, P additive
   Performance: N regression, M risk, P smell
   Conventions: N violations, M drift, P suggestions
   ```

5. Do not propose fixes beyond what the reviewers suggested. If the user wants fixes applied, they can spawn engineers in a follow-up.

6. Clean up the team when the consolidated report is delivered: tell the user "Team done — say 'cleanup team' to release resources" and wait for that instruction before calling cleanup. Do not auto-cleanup; the user may want to ask reviewers follow-up questions.
