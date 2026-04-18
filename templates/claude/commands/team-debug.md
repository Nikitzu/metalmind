---
description: Spawn a 3-5 adversary team to debug a bug via competing hypotheses and scientific debate.
argument-hint: <bug-description-or-issue-ref>
---

You are about to create a debugging team that uses competing hypotheses. Multiple `adversary` teammates form distinct root-cause theories, argue via SendMessage, and converge on the most-defensible answer.

**Target:** `$ARGUMENTS` (a bug description, a Linear issue ref, a log paste, or a repro snippet)

**Steps:**

1. Read the bug context. If `$ARGUMENTS` is a Linear issue ref (e.g., `BUG-123`), use the Linear MCP tools to fetch the issue. If it's a file path, read it. If it's a description, note any gaps you want teammates to fill.

2. Extract: reproduction steps, observed behaviour, expected behaviour, environment, recent changes.

3. Spawn three adversary teammates — one of each variant — so the debate covers distinct intellectual angles:
   - `adversary` (base) — generalist devil's advocate
   - `adversary-skeptic` — evidence-first, lateral-thinking (environmental/timing/caching/race conditions)
   - `adversary-archaeologist` — history-first, reads git log before source

   All three are Opus + high effort. For larger or long-running bugs, you may add one or two more `adversary` base teammates for additional perspectives; do not exceed 5 adversaries total. Each teammate's spawn prompt:
   - Contains the full bug context
   - Asks them to form their OWN initial hypothesis independently, BEFORE seeing others' theories
   - Instructs them to gather evidence for and against their own theory — consistent with their variant's bias (skeptic looks laterally first; archaeologist walks the timeline first)
   - Instructs them to actively attack other teammates' theories once those are shared
   - Instructs them never to propose a fix — only find the cause

4. Wait for each teammate to produce its initial hypothesis.

5. Broadcast all hypotheses to all teammates. Instruct them to debate via SendMessage — the goal is not to win but to converge on the theory with the strongest evidence.

6. Monitor the debate. If teammates anchor or go in circles, intervene with concrete questions ("teammate X, what specific evidence would disprove your theory?").

7. When consensus emerges (or persistent disagreement with defined tests to break the tie), produce a summary for the user:

   ```
   ## Debug team consensus: <bug>
   
   ### Converged hypothesis
   <theory> — confidence: <low|medium|high>
   
   ### Evidence
   - <file:line citations supporting the theory>
   
   ### Theories rejected
   - <alternative> — rejected because <counter-evidence>
   
   ### Remaining uncertainty
   - <what's still unclear>
   - <concrete tests that would resolve it>
   
   ### Recommended next step
   <one action — spawn an engineer to fix, add a test, gather more logs, etc.>
   ```

8. Do not auto-spawn an engineer to fix. Wait for the user to decide.

9. Wait for the user to say "cleanup team" before releasing resources.
