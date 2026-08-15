# Spec: Per-vault confidence calibration

Design note: `Plans/2026-08-13-metalmind-confidence-calibration-per-vault-bands.md` (maintainer vault).
Measurement: `bench/confidence-bands/README.md`.

## Assumptions

1. The signal is `sem_score` (raw embedder cosine), best value among the hits returned for a query. Fused RRF scores and BM25 are excluded, both for measured reasons.
2. Calibration runs inside the Python package, against the collection just indexed, not in the CLI.
3. The CLI renders what `/search` reports and does no threshold arithmetic of its own.
4. Confidence is advisory. It never removes a hit from the result set in this iteration.
5. The probe set ships with the package as a static fixture, and is authored rather than derived from a licensed third-party dataset.
6. Existing installs stay on their current behaviour until they next run a full reindex.

## Objective

Give a caller of `tap copper` a defensible answer to "does this vault actually contain what I asked for". Today it cannot answer that: fused scores separate answerable from unanswerable questions at AUC 0.549, a coin flip.

Raw cosine does separate them, at AUC 0.984 on a real 330-note vault. But the threshold that exploits it is corpus-shaped, so it cannot ship as a constant. The system derives its own edges from the vault in front of it.

Success is a user asking about something absent from their vault and seeing the tool say so, without any real recall being suppressed.

## Functional Requirements

**Calibration**

- WHEN a full reindex completes THE SYSTEM SHALL derive confidence edges for that collection and write them to a calibration sidecar.
- WHEN deriving the low edge THE SYSTEM SHALL sample at most 150 indexed chunks, build one query per chunk from a body sentence with the note's title tokens removed, and set the low edge to the 10th percentile of the best cosine returned per query.
- WHEN deriving the high edge THE SYSTEM SHALL run the 100 shipped probe queries and set the high edge to the 95th percentile of the best cosine returned per query.
- THE SYSTEM SHALL record the embedder identifier, both edges, both sample sizes, and a timestamp in the sidecar.
- IF the vault yields fewer than 50 usable chunks, THEN THE SYSTEM SHALL write no sidecar and report no confidence.
- IF the derived high edge is greater than or equal to the derived low edge, THEN THE SYSTEM SHALL write no sidecar, because the classes did not separate on this vault.
- WHILE an incremental single-file reindex is running THE SYSTEM SHALL NOT recalibrate.
- WHERE the operator requests recalibration explicitly THE SYSTEM SHALL recalibrate without a full reindex.

**Reporting**

- WHEN a search returns hits and a valid sidecar exists THE SYSTEM SHALL include a result-set-level `confidence` of `high`, `medium`, or `low`.
- THE SYSTEM SHALL classify a result set as `high` when the best cosine among its hits is at or above the low edge, `low` when below the high edge, and `medium` otherwise.
- IF the sidecar's embedder identifier does not match the active embedder, THEN THE SYSTEM SHALL ignore the sidecar and report no confidence.
- IF no sidecar exists, THEN THE SYSTEM SHALL omit `confidence` from the response and SHALL NOT warn.
- WHERE `METALMIND_CONFIDENCE=0` is set THE SYSTEM SHALL omit `confidence` from the response.
- THE SYSTEM SHALL NOT reorder, filter, or remove hits on the basis of confidence.

**CLI**

- WHEN a recall returns `confidence` of `low` THE SYSTEM SHALL print one advisory line beneath the hits.
- WHEN a recall returns `confidence` of `medium` or `high` THE SYSTEM SHALL print nothing extra.

## Tech Stack

Python package `metalmind-vault-rag` (sqlite-vec, fastembed, FTS5) and the TypeScript CLI (commander, clack, zod). No new dependencies.

## Commands

```
Build CLI:      cd cli && pnpm build
Typecheck:      cd cli && pnpm typecheck
CLI tests:      cd cli && pnpm test
Python tests:   cd packages/vault-rag && uv run --extra dev pytest tests/
Band bench:     node bench/confidence-bands/run.mjs
```

## Project Structure

```
packages/vault-rag/metalmind_vault_rag/calibration.py   → edge derivation, sidecar read/write
packages/vault-rag/metalmind_vault_rag/probes.json      → 100 shipped probe queries
packages/vault-rag/metalmind_vault_rag/indexer.py       → calls calibration after a full reindex
packages/vault-rag/metalmind_vault_rag/search.py        → attaches confidence to a result set
packages/vault-rag/metalmind_vault_rag/http_server.py   → exposes it on /search
packages/vault-rag/tests/test_calibration.py            → band arithmetic, invalidation, refusal
cli/src/backends/recall.ts                              → renders the advisory line
cli/src/backends/recall.test.ts                         → rendering tests
~/.metalmind/<collection>.calibration.json              → the sidecar (not in the repo)
```

## Code Style

Match `search.py`. Module-level tunables read from the environment with a documented default, and a docstring that states why a number is what it is rather than restating it:

```python
# p10 is where the automatic excerpt protocol most closely reproduces
# hand-authored questions (delta 0.003, against 0.018 at p5 and 0.012 at
# p20). The low edge belongs where that substitution is most faithful.
LOW_EDGE_PERCENTILE = float(os.environ.get("METALMIND_CONFIDENCE_LOW_PCT", "10"))
HIGH_EDGE_PERCENTILE = float(os.environ.get("METALMIND_CONFIDENCE_HIGH_PCT", "95"))
```

## Testing Strategy

`pytest` for the Python side, `vitest` for the CLI, both already wired.

- Unit: band classification at and around each edge, embedder-mismatch invalidation, the two refusal paths (too few chunks, edges not separated), sidecar round-trip.
- Integration: index a small fixture vault, assert a sidecar appears with separated edges, assert an out-of-domain query reports `low`.
- Regression: `bench/confidence-bands` asserts the tool's self-derived edges land within tolerance of the measured 0.6983 and 0.6779 on the maintainer vault.
- External validation: one run against `xy-241/CS-Notes` (MIT, 764 notes, a real Obsidian vault) confirming the procedure produces separated bands on a corpus we did not shape.

Every test must be shown to fail before its fix lands. The `test_concurrency.py` episode is the precedent: a test that passed with and without the fix proved nothing.

## Boundaries

**Always**
- Keep the sidecar out of the index schema, so no upgrade forces a reindex.
- Leave existing installs untouched until their next full reindex.
- Record the embedder id beside any derived threshold.

**Ask first**
- Any change to the default `tap copper` output that fires on a normal, confident recall.
- Turning confidence into a filter rather than a report.
- Adding a config field, which would mean a schema migration to v5.

**Never**
- Ship a hardcoded threshold constant.
- Suppress a hit on the basis of confidence in this iteration.
- Commit the probe scores or edges derived from a private vault.

## Success Criteria

1. On the maintainer vault, the self-derived low edge lands within 0.01 of the benchmark-derived 0.6983. **Met: 0.6996, delta 0.0013.** The high edge has no equivalent target, because it is now derived from the shipped probe set rather than from LongMemEval, so the two numbers measure different distributions and comparing them would be meaningless. Its check is criterion 2.
2. On the same vault, out-of-domain probes report `low` or `medium` at least 90% of the time. **Met: 99%, of which 94% `low`.**
3. Hand-authored positives report `high` at least 85% of the time. **Met: 86%.**
3b. Near-miss probes report `high` no more than 50% of the time, since they are unanswerable and `high` on them is the tool claiming confidence about absent content. **Met: 21%.**
4. A vault with no sidecar behaves exactly as it does today, byte for byte, in both CLI output and the `/search` payload.
5. Full calibration adds under 30 seconds to a full reindex on a 330-note vault. The T2 spike measured in-process search at 0.03s per query against 0.2s over HTTP, because the embedder is already loaded, so 250 calibration queries cost roughly 8 seconds rather than the 40 to 60 originally budgeted.
6. CS-Notes produces separated edges without hand tuning.

## Clarifications

Both questions carried in from the design are settled from the existing benchmark data rather than by preference:

1. **Percentiles: p10 low, p95 high.** p10 is where excerpt and hand-authored positives agree most closely (delta 0.0031, against 0.0179 at p5). p95 halves false high-confidence on blanks relative to p90 (11% to 6%) at no cost to positives. p99 is rejected: its edge crosses the low edge and the classes stop separating.
2. **Three bands, not two.** At p10/p95 the middle band holds 10% of real answers and 3% of blanks. Rare enough to carry meaning when shown, and it distinguishes "probably absent" from "unsure".
3. **Probe count raised from 60 to 100.** p95 of 60 samples is the third-highest observation, too noisy to anchor an edge. 100 probes cost roughly 20 seconds.

Three further decisions, taken with the maintainer:

4. **The CLI advisory fires on `low` only.** Firing on `medium` would caveat 10% of real recalls to catch 3% of blanks, and a warning that fires on good results teaches the reader to ignore it. All three bands remain in the `/search` payload, so an agent can still act on `medium` while the CLI stays quiet.
5. **Calibration blocks the end of a full reindex.** Roughly 40 to 60 seconds onto an operation that already takes minutes, in exchange for determinism: when indexing reports done, confidence works. A detached pass would need supervision and would create a window where a missing confidence field looks like a bug rather than a state.
6. **Probes are authored fresh, not borrowed.** The high edge depends on probes being unanswerable *by construction*, which needs invented proper nouns. LongMemEval questions ask about generic personal facts, and a vault with a `Personal/` folder could genuinely answer some of them, inflating the edge.

## Open Questions

None. All clarifications are resolved above.
