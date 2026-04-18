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

2. Select the reviewer role:
   - Default: `conventions-reviewer` (Sonnet, low effort) for pattern/style audits
   - With `--security` flag: `security-reviewer` (Opus, high effort) for vulnerability audits

3. Spawn one teammate per repo, all of the same selected role. Each teammate's spawn prompt must include:
   - The specific repo path to `cd` into
   - The pattern/concern to audit for (verbatim from the user's argument)
   - Instruction to report findings with file:line citations relative to that repo root
   - Instruction NOT to modify any files — this is a read-only audit

4. Teammates work independently. They should NOT talk to each other — findings should be independent per repo.

5. When all teammates report back, produce a cross-repo synthesis:

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

6. Wait for the user to say "cleanup team" before releasing resources.
