# Spec: Jev judgments in metalmind

Design notes: `Work/tzmem-mvp-a-cli-for-every-agent-jev-as-the-ci-judge.md` and `Learnings/typesafe-noul-vs-tzcript-token-matcher.md` (maintainer vault). API contract read from `https://docs.typesafe.ai/api.md` on 2026-09-17.

## Assumptions

1. Jev (TypeSafe `jev-latest`) is called from the CLI only, at save and recall time, over `POST https://api.typesafe.ai/v1/systemone` with plain `fetch`. No SDK dependency, no change to the Python watcher, no change to the loopback recall contract.
2. The judge is opt-in per install (`config.judge.enabled`) and needs a key. Without either, every command behaves exactly as today.
3. Embeddings stay the first pass. Jev only ever sees the top candidates the local index already returned; it never searches the vault.
4. The judge is advisory on recall and can refuse on save. It never touches `sync`.
5. Calibration against judged labels is a bench, not a runtime feature. `specs/per-vault-confidence-calibration.md` keeps owning the runtime bands.
6. The only network hop besides the local watcher is the TypeSafe API; query text and candidate snippets leave the machine when the judge is on.

## Objective

Make two questions answerable that cosine similarity cannot answer: "is this draft the same decision as an existing note" and "does this hit actually answer the query". Today `scribe create` prints `0.80  Work/some-note.md` for a note that shares vocabulary and disagrees in substance, and `tap copper` ranks by fused score with no notion of relevance to the question asked.

Where a judgment already exists in the CLI, Jev replaces it rather than sitting beside it: the 0.80 overlap warning, the cross-encoder `--rerank`, and the "low confidence" line are each the unjudged fallback, never a second opinion in the same output.

Success: a draft that restates an existing note is refused with the note named; a draft on the same topic with a different decision is created with "extends" or "unrelated" said out loud; a recall shows its hits in judged order with the tail dropped; turning the judge off, losing the network, or removing the key restores today's behaviour without a stack trace.

## Functional Requirements

**Judge client**

- THE SYSTEM SHALL send judgments to `POST https://api.typesafe.ai/v1/systemone` with `Authorization: Bearer <key>`, `model: "jev-latest"`, one `state` and a named `questions` map, and read `answers` by the same names.
- THE SYSTEM SHALL resolve the key from `TYPESAFE_API_KEY`, else from the macOS Keychain item with service `typesafe-api-key` via `security find-generic-password -s typesafe-api-key -w`, else report "no key".
- THE SYSTEM SHALL cap one judge call at 4 000 ms and SHALL treat a timeout, a network error, a 401, a 422, a 429 and a 529 as "unjudged" for that call, with no retry.
- WHEN a call returns "unjudged" THE SYSTEM SHALL print one line naming the reason class (no key, offline, timeout, rejected) and SHALL NOT change the command's exit code.
- THE SYSTEM SHALL never write the key, the request body or the response body to any file or log.
- THE SYSTEM SHALL send at most 2 000 characters of any note or draft in `state`, taken from the start of the body, and SHALL never send frontmatter.

**Overlap verdicts on `scribe create`**

- WHERE the judge is enabled THE SYSTEM SHALL run the overlap search before the note is written, not after.
- WHERE the judge is enabled THE SYSTEM SHALL lower the overlap candidate cut from 0.80 to 0.60 and take at most 3 candidates.
- WHEN candidates exist THE SYSTEM SHALL ask, per candidate in one request, one Score `coverage` with ordered levels `distinct` (0: shares words or subject only), `overlaps` (1: same subject, but the draft carries a decision, reason, number or condition the note lacks), `covered` (2: a reader looking for this would be satisfied by the existing note; the draft adds nothing they need, even if worded, scoped or ordered differently).
- IF `coverage` is at or above 1.5 for any candidate, THEN THE SYSTEM SHALL refuse the create, print that candidate and `metalmind scribe update <kind:slug>`, and exit non-zero.
- IF `coverage` is between 0.5 and 1.5, THEN THE SYSTEM SHALL create the note and print `extends <note>`.
- IF `coverage` is below 0.5, THEN THE SYSTEM SHALL create the note and print nothing about that candidate.
- WHERE `--force` is passed THE SYSTEM SHALL create the note regardless of the verdict and print the verdict it overrode.
- WHERE `--dry-run` is passed THE SYSTEM SHALL still judge and print verdicts, and write nothing.
- IF the judge is disabled or unjudged, THEN THE SYSTEM SHALL keep today's behaviour: create, then warn at 0.80. WHILE judged THE SYSTEM SHALL NOT print the 0.80 warning.
- WHILE creating a `daily` note THE SYSTEM SHALL NOT judge.

**Overlap verdicts on `scribe update`**

- WHERE the judge is enabled THE SYSTEM SHALL judge the appended body against the top 3 candidates excluding the target note with the same `coverage` rule, refuse at or above 1.5 naming the note that already covers it, and print `extends` between 0.5 and 1.5. `--force` overrides as on create.

**Recall reranking on `tap copper`**

- WHERE the judge is enabled THE SYSTEM SHALL rerank every `tap copper` call unless `--no-judge` is passed: fetch `max(k, 10)` hits from the watcher, ask one Score `relevance` per hit in one request with levels `off-topic` (0), `related` (1), `answers` (2), and order hits by `score` descending, ties by the original order.
- THE SYSTEM SHALL drop hits with `score` below 1.0 (expected level below `related`), mark hits at or above 1.5 as answering in the rendered line, and print `judged: N of M kept` beneath the hits.
- WHERE the judge is enabled THE SYSTEM SHALL treat `--rerank` as a no-op alias for the judged path; the cross-encoder path (`rerank-bootstrap.ts`, the `[rerank]` Python extra, `rerank: true` on `/search`) is removed once `bench/judge-relevance` shows the judge at or above the cross-encoder on the maintainer vault.
- IF fewer than 1 hit survives, THEN THE SYSTEM SHALL print the original top-k unjudged with a line saying so, rather than an empty result.
- WHERE `--json` is passed THE SYSTEM SHALL add `judge: { score, level }` to each hit and `judged: true|false` at the top level.
- WHILE the transport is stdio fallback THE SYSTEM SHALL NOT judge.
- WHILE judged THE SYSTEM SHALL replace the watcher's "low confidence" advisory line with the judged summary and SHALL NOT print both.
- THE SYSTEM SHALL NOT alter the watcher's `confidence` band or sidecar on the basis of judged scores.

**Configuration**

- THE SYSTEM SHALL add `judge: { enabled: boolean (false), model: string ("jev-latest") }` to the config schema at version 6 and migrate version 5 configs by defaulting it. Rerank has no separate switch: enabled means judged overlap and judged recall.
- THE SYSTEM SHALL expose `metalmind judge status` printing enabled, key source (env, keychain, none) and model, without calling the API.
- WHEN any judged step fails to reach Jev THE SYSTEM SHALL say so in that command's output as `unjudged: <reason>` (no key, offline, timeout, rejected) and, for `rejected`, include the HTTP status. That line is the only place a failing key or endpoint is reported.
- WHERE `METALMIND_JUDGE=0` is set THE SYSTEM SHALL behave as if the judge is disabled.

**Calibration bench**

- THE SYSTEM SHALL add `bench/judge-relevance/` that runs a query set against a vault with and without the judge, records per-hit `score` beside `sem_score`, and reports agreement with the existing confidence bands.
- THE SYSTEM SHALL NOT ship judged labels into the calibration sidecar in this iteration.

## Tech Stack

TypeScript CLI (commander, clack, zod, vitest, Biome). Node `fetch`. No new npm dependency. Python package untouched.

## Commands

```
Build CLI:      cd cli && pnpm build
Typecheck:      cd cli && pnpm typecheck
CLI tests:      cd cli && pnpm test
Lint:           pnpm biome check .
Judge probe:    metalmind judge status
Bench:          node bench/judge-relevance/run.mjs --vault ~/Knowledge --queries bench/judge-relevance/queries.json
```

## Project Structure

```
cli/src/judge/client.ts          → key resolution, one request, timeout, unjudged reasons
cli/src/judge/client.test.ts     → fake fetch, every failure class, key precedence, redaction
cli/src/judge/overlap.ts         → coverage score per candidate, verdict rendering
cli/src/judge/overlap.test.ts
cli/src/judge/rerank.ts          → relevance scoring, ordering, drop rule
cli/src/judge/rerank.test.ts
cli/src/scribe/dedup.ts          → candidate cut becomes a parameter; unchanged otherwise
cli/src/commands/scribe.ts       → judge before write on create, verdicts on update, --force
cli/src/commands/tap.ts          → --no-judge flag, rerank hook, json fields, --rerank alias
cli/src/commands/judge.ts        → `judge status`
cli/src/config.ts                → schema v6 with judge block, migration
cli/src/index.ts                 → command registration
bench/judge-relevance/           → run.mjs, queries.json, README.md
```

## Code Style

Match `cli/src/scribe/dedup.ts`: module-level constants with the reason in the name or a one-line why, an options object, `fetch` with an `AbortController`, return a typed empty on failure instead of throwing.

```ts
export type Unjudged = 'no-key' | 'offline' | 'timeout' | 'rejected';

export interface JudgeResult<T> {
  answers: T | null;
  unjudged?: Unjudged;
  usage?: { input_tokens: number; output_tokens: number };
}

export async function judge<T>(state: unknown, questions: Record<string, Question>): Promise<JudgeResult<T>> {
  const key = await resolveKey();
  if (!key) return { answers: null, unjudged: 'no-key' };
  ...
}
```

## Testing Strategy

vitest, tests beside the module. Every failure class of the client is a unit test with a mocked `fetch`. Overlap and rerank tests take canned `answers` and assert verdicts, ordering and rendered lines. Command tests assert the order "judge, then write" on create with a spy on the writer. One manual acceptance run on the maintainer vault with the two notes from 2026-09-17: the talk note must score below 1.5 (created, at most `extends`), a re-submitted draft must be refused as covered.

## Boundaries

- Always: run `pnpm test` and `pnpm typecheck` before a commit; keep the judge behind the config flag; redact everything the client sends and receives from logs; keep the watcher and the loopback contract untouched.
- Ask first: any new dependency; any change to the Python package; raising the 2 000 character state cap; removing the cross-encoder before the bench result; any write into the calibration sidecar.
- Never: register the judge as an MCP tool; call the judge from `sync`; store the key anywhere but env or Keychain; block a recall on the judge; publish judged numbers outside the vault (MCA 2.3(f)).

## Success Criteria

1. `metalmind scribe create` with the judge on refuses a draft that restates `Work/tzmem-mvp-a-cli-for-every-agent-jev-as-the-ci-judge.md` as covered and names it; with `--force` it creates and prints the overridden verdict.
2. The same command for that note against `Work/tzmem-and-oberth-talk-september-2026.md` scores below 1.5 and creates, at most with `extends`.
3. `metalmind tap copper "<query>"` with the judge enabled prints judged order, marks answering hits, and `judged: N of M kept`; with `--no-judge` or `METALMIND_JUDGE=0` the output is byte-identical to today.
4. Unplugging the network and re-running both commands yields today's behaviour plus one "unjudged: offline" line, exit codes unchanged.
5. `metalmind judge status` reports the key source without calling the API and without printing the key; a revoked key shows up as `unjudged: rejected 401` on the next judged command.
7. `bench/judge-relevance` reports judge versus cross-encoder on the maintainer vault; the cross-encoder removal is a separate commit gated on that number.
6. All existing CLI tests pass; new tests cover every `Unjudged` reason.

## Clarifications

1. Refusal rule (create and update): one Score `coverage` per candidate over `distinct` / `overlaps` / `covered`; refuse at or above 1.5, `extends` between 0.5 and 1.5, silent below. Reason: a duplicate is a note that already satisfies the reader the draft is for, similar rather than identical; the criteria text tells the judge to ignore wording, scope and order. One question per candidate, no separate relation choice; `supersedes` is not a verdict in this iteration.
2. Rerank drop rule: drop expected level below `related` (score < 1.0), mark `answers` (score ≥ 1.5). Keeps the context middle, removes the noise tail; an answers-only cut empties fuzzy queries.
3. Rerank is on whenever the judge is enabled; `--no-judge` per call. No separate config switch.
4. `scribe update` refuses under the same rule as create, `--force` overrides.
5. State cap 2 000 characters per candidate.
6. No probe in `judge status`. Every judged command reports its own failure inline as `unjudged: <reason>`, which is where the user is when it matters.
7. Replace, not add: the 0.80 warning, the cross-encoder rerank and the "low confidence" line are fallbacks for the unjudged path, never printed beside a verdict. The cross-encoder is deleted after the bench.

## Round 2, 2026-09-18: full power and evidence

Read against the TypeSafe docs (state, primitives, confidence, rerank cookbook).

8. Refusal is gated on confidence: `coverage ≥ 1.5` refuses only when `confidence ≥ 0.6`; below that the note is created with a `covered? ... low confidence, creating anyway` line. The docs do not claim confidence is calibrated, so the log below is what tunes 0.6.
9. State carries the facts a reader would glance at: for drafts and candidates, title, kind, project, tags, created and updated; for recall hits, the same plus heading. Instructions say these are context, not the answer.
10. Request shape: batched (all candidates in one request) stays the default. Measured on the maintainer vault: batched top-1 20/20, MRR 1.000; one request per hit (`METALMIND_JUDGE_MODE=each`, the cookbook's shape) 17/20, MRR 0.917. Independent judgments lose the relative comparison a ranking needs.
11. Every judge call appends one line to `~/.metalmind/judge-log.jsonl`: timestamp, command, model, latency, usage, per-answer score, confidence, probabilities and file, the decision, and `forced` when `--force` was passed. No note text, no query text. `metalmind judge report [--days N]` summarises refusals, forced overrides (the human saying "wrong"), kept ratio on recall, score and confidence histograms, latency percentiles and input tokens. `METALMIND_JUDGE_LOG` overrides the path.
12. Unchanged: without a key, or with `METALMIND_JUDGE=0`, or with the judge disabled, every command behaves as before 0.25.0.

## Open Questions

None.
