---
description: Spawn one reviewer per target repo in parallel to audit for a shared pattern or concern. Synthesises cross-repo findings.
argument-hint: <pattern-or-concern> <repo-path-1> <repo-path-2> ... [--security]
---

You are about to create a cross-repo audit team. Each teammate owns exactly one repo.

**Target:** `$ARGUMENTS`

Parse `$ARGUMENTS` as:
- First token: the pattern or concern description (quoted if it has spaces)
- Subsequent path-like tokens: target repo directories
- Optional `--security` flag: use `security-reviewer` instead of `conventions-reviewer`

**Steps:**

1. Validate each repo path exists and is a git repo. If any don't, stop and ask the user.

2. **Recall prior context.** Run `Bash: {{RECALL_CMD}} "<audit-pattern-keywords>" --deep` to surface prior audits of the same concern, known exceptions, and historical findings from the vault. Include any hits in each reviewer's spawn prompt as "prior context (from vault)" so reviewers know what's already been documented. If the user has native auto-memory off (`CLAUDE_CODE_DISABLE_AUTO_MEMORY=1`), this is the only place prior context enters the team.

3. Select the reviewer role:
   - Default: `conventions-reviewer` (Sonnet, low effort) for pattern/style audits
   - With `--security` flag: `security-reviewer` (Opus, high effort) for vulnerability audits

4. Spawn one teammate per repo, all of the same selected role. Each teammate's spawn prompt must include:
   - The specific repo path to `cd` into
   - The pattern/concern to audit for (verbatim from the user's argument)
   - Instruction to report findings with file:line citations relative to that repo root
   - Instruction NOT to modify any files — this is a read-only audit

5. Teammates work independently. They should NOT talk to each other — findings should be independent per repo.

6. When all teammates report back, produce a cross-repo synthesis:

   ```
   ## Cross-repo audit: <concern>
   
   ### Per-repo findings
   #### <repo-1>
   - file:line — finding
   - ...
   
   #### <repo-2>
   - ...
   
   ### Cross-cutting observations
   - <patterns that appeared in multiple repos>
   - <repos that were clean>
   
   ### Recommended follow-ups
   - <actionable next steps ordered by impact>
   ```

7. Wait for the user to say "cleanup team" before releasing resources.
