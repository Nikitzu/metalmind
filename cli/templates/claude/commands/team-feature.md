---
description: Spawn an architect-led team to design and implement a feature across backend/frontend/tests.
argument-hint: <spec-file-path-or-feature-description>
---

You are about to create a feature-development agent team. The architect plans first, engineers implement, QA tests, conventions-reviewer sweeps at the end.

**Target:** `$ARGUMENTS` (a path to a spec file, a plan file, or a natural-language description of the feature)

**Steps:**

1. Read the target. If it's a file path, read it. If it's a description, synthesise the scope yourself.

2. **Recall prior context.** Run `Bash: {{RECALL_CMD}} "<feature-name-or-keywords>" --deep` to surface prior decisions, related plans, and cross-repo patterns from the vault. Pass any hits into the architect's spawn prompt as a "prior context (from vault)" section so the teammate doesn't re-derive what's already recorded. If the user has native auto-memory off (`CLAUDE_CODE_DISABLE_AUTO_MEMORY=1`), this is the only place prior context enters the team.

3. Spawn the `architect` teammate first (Opus, high effort). Pass the spec as its spawn prompt with these **explicit, prompt-level constraints** (do not rely on `permissionMode: plan` from frontmatter — it likely does not propagate to teammates):
   - "Do NOT write or edit any files until your plan has been approved by the lead. Treat this instruction as the binding constraint, regardless of what your role definition's `permissionMode` says."
   - "Acknowledge this read-only constraint in your first message back to the lead before doing any exploration."
   - "Produce an implementation plan using the writing-plans skill conventions at `~/Documents/plans/<project>/YYYY-MM-DD-<feature>.md`."
   - "Identify which layers need changes (backend/frontend/data/infra)."
   - "Define the disjoint file sets each engineer will own — no two engineers should edit the same file."
   - "Submit the plan to the lead via SendMessage and wait for approval before any file writes."

4. Wait for the architect's plan approval request. Review the plan against:
   - User's plan conventions (bite-sized tasks, exact paths, complete code in steps)
   - Clear disjoint file ownership per engineer (no two engineers editing the same file)
   - TDD ordering where appropriate

5. On plan approval, spawn one teammate per layer identified by the architect:
   - `backend-api-engineer` if API changes are needed
   - `backend-data-engineer` if schema changes are needed
   - `backend-infra-engineer` if CI/deploy changes are needed
   - `frontend-web-engineer` if web UI changes are needed
   - `frontend-mobile-engineer` if mobile UI changes are needed
   - `qa-engineer` last, after other engineers complete
   Each engineer gets its disjoint file set in its spawn prompt.

6. Engineers work in parallel on their own files. You coordinate: surface blocker messages, reassign tasks if needed, approve plan-mode escalations from individual engineers.

7. After all engineers finish, spawn `qa-engineer` to write tests against the new code.

8. Optionally, spawn `conventions-reviewer` for a final style sweep before the user opens a PR.

9. Produce a summary for the user:
   - Files changed per layer
   - Test coverage delta
   - Any unresolved concerns engineers surfaced
   - Recommended commit/PR message

10. Wait for the user to say "cleanup team" before releasing resources.
