# Spec: Chunker rework (identity, heading context, sentence boundaries)

The retrieval work the index-format stamp was built to permit. One format bump,
one rebuild for users.

## Assumptions

1. `(file, heading)` is the wrong identity for a chunk. It is a proxy that holds only while a section yields exactly one chunk, and the whole point of this arc is to produce more than one.
2. The bare chunk text stays what is stored and displayed. Only the string handed to the embedder changes. Snippets, neighbours, and the FTS table keep working on the text a human wrote.
3. Chunk size and overlap are swept against benches, not chosen. The same discipline that settled the confidence percentiles applies: a number picked by taste and defended afterwards is how the last arc nearly shipped a broken probe set.
4. This is one format bump, 1 to 2. Splitting it means two rebuilds for every user, and avoiding that was the reason the stamp arc came first.
5. Keyword retrieval is out of scope. Contextual retrieval applies to BM25 too, but changing what FTS indexes means either wrong snippets or a schema change, and this arc is large enough.

## Objective

Three changes, measured together because they share a rebuild.

**A. Chunk identity in fusion.** `_rrf_merge` de-duplicates on `(file, heading)`. Two chunks from the same section collapse into one hit, keeping whichever the retriever happened to return first. On the maintainer vault that hides 76 of 3353 chunks today, which is minor. Under B and C it becomes the dominant failure mode: smaller chunks would make retrieval measurably worse, and the bench would show the regression without explaining it.

**B. Heading-embedded chunks.** `_embed_chunks` embeds bare chunk text while the heading path sits unused in the payload. A chunk reading "it depends on the lock ordering" is unfindable; the same chunk embedded as "sqlite concurrency / WAL mode: it depends on the lock ordering" is not.

**C. Sentence-boundary splits with overlap.** `chunk_markdown` hard-cuts at 3500 characters mid-word with no overlap, so a fact spanning the cut is in neither chunk intact.

Success is the weak half of the LongMemEval table moving. `single-session-preference` at 13% hit@1 and `single-session-user` at 17% are the categories where a fact is one implicit aside inside a long session, which is exactly what B and C address.

## Functional Requirements

**Identity**

- THE SYSTEM SHALL carry `chunk_idx` in the vector payload alongside `file` and `heading`.
- WHEN fusing two hit lists THE SYSTEM SHALL treat `(file, heading, chunk_idx)` as one document.
- WHEN two chunks from the same section both match THE SYSTEM SHALL return them as distinct hits rather than discarding either.
- WHERE a hit carries `chunk_idx` THE SYSTEM SHALL resolve its neighbours from that index rather than by matching text.

**Embedding**

- THE SYSTEM SHALL embed each chunk as its note title, its heading path, and its text.
- THE SYSTEM SHALL store and return the chunk text alone, without the synthesized prefix.
- THE SYSTEM SHALL index the chunk text alone in FTS5.

**Chunking**

- THE SYSTEM SHALL split a section at sentence boundaries rather than at a fixed character offset.
- THE SYSTEM SHALL overlap consecutive chunks from the same section.
- IF a single sentence exceeds the chunk target, THEN THE SYSTEM SHALL emit it whole rather than cutting it.
- THE SYSTEM SHALL expose the chunk target and overlap as environment-tunable values so a sweep does not need a rebuild of the tool.

**Format**

- THE SYSTEM SHALL record format version 2.
- WHEN an index built in format 1 is read THE SYSTEM SHALL report it stale and keep answering recalls.

## Tech Stack

Python package `metalmind-vault-rag`, TypeScript CLI. No new dependencies. Sentence splitting reuses the regex approach already in `calibration._body_sentences` rather than adding a tokenizer.

## Commands

```
Python tests:   cd packages/vault-rag && uv run --extra dev pytest tests/
CLI tests:      cd cli && pnpm test
Typecheck:      cd cli && pnpm typecheck
Fast bench:     node bench/recall-v0/run.mjs
Scale bench:    node bench/recall-at-scale/run.mjs
Gate bench:     node bench/longmemeval/run.mjs --scale 3000 --keep-index
Bands:          node bench/confidence-bands/run.mjs --assert
```

## Project Structure

```
packages/vault-rag/metalmind_vault_rag/core.py          - chunk_markdown, embed_text, point_id
packages/vault-rag/metalmind_vault_rag/indexer.py       - payload gains chunk_idx
packages/vault-rag/metalmind_vault_rag/search.py        - fusion identity, attach_neighbors
packages/vault-rag/metalmind_vault_rag/index_format.py  - FORMAT_VERSION 2, chunker descriptors
packages/vault-rag/tests/test_chunker.py                - new
bench/longmemeval/results/                              - before and after
```

## Code Style

Match `core.py`. Tunables read from the environment with the swept value as the
default and the evidence in the docstring:

```python
CHUNK_TARGET_CHARS = int(os.environ.get("VAULT_CHUNK_TARGET_CHARS", "1200"))
CHUNK_OVERLAP_CHARS = int(os.environ.get("VAULT_CHUNK_OVERLAP_CHARS", "200"))
```

## Testing Strategy

- Unit: sentence splitting at boundaries, overlap content, an oversized sentence emitted whole, empty and heading-only sections, the embedded string versus the stored text.
- Fusion: two chunks of one section survive as separate hits; the same chunk from both retrievers still merges to one.
- Regression: `attach_neighbors` resolves from `chunk_idx`, including where two chunks share text through overlap, which the old text lookup could not disambiguate.
- Bench: LongMemEval at scale 3000 before and after, per-type. `recall-v0` and `recall-at-scale` as guards. `confidence-bands --assert` to confirm the bands still separate.
- Every test shown to fail against a targeted mutation, with a `touch` after each write so same-length edits are not masked by the build cache.

## Boundaries

**Always**
- Bench before and after, on the same corpus and scale.
- Keep the stored text identical to what the note contains.
- Treat a per-type regression as a result, not as noise to re-run away.

**Ask first**
- Changing what FTS5 indexes.
- Any chunk target that would multiply index size by more than roughly three.
- Shipping if a weak category improves while a strong one regresses.

**Never**
- Pick chunk size or overlap by taste and defend it afterwards.
- Ship without a rebuild path, which now exists.
- Change stored text to match embedded text.

## Success Criteria

1. `single-session-preference` and `single-session-user` hit@1 both improve against the recorded 13% and 17%.
2. Overall hit@1 does not regress below the recorded 36%, and hit@5 not below 68%.
3. No category regresses by more than 3 points without an explanation recorded in the bench README.
4. `recall-v0` and `recall-at-scale` show no regression.
5. `confidence-bands --assert` still derives separated bands, with the new edges recorded as the expected values.
6. An index built in format 1 reports stale, keeps answering, and `metalmind index rebuild` clears it.
7. Index size grows by less than roughly 3x on the maintainer vault.

## Clarifications

1. **Sweep at `--scale 500`, confirm the winner at 3000.** Four configurations at roughly 12 minutes each, then the winner and the recorded baseline at the gate scale. The sweep ranks; the confirmation run decides. If the winner fails to reproduce at 3000, that is a finding about distractor density and gets recorded rather than swept under a re-run.
2. **Overlapping chunks surface as distinct hits.** They are different chunks with different scores, and collapsing them would reintroduce the very behaviour this arc removes, merely scored rather than arbitrary. The cost is that a sentence inside an overlap can appear twice, which is accepted and worth watching in the token-budget bench.
3. **The note title is the humanised filename stem.** Always present, descriptive because scribe generates the slug from the title, and identical in behaviour for a hand-made note dragged into the vault. No frontmatter parse at index time and no branch that only some notes exercise.

4. **No fresh baseline. The recorded 2026-08-11 run is the before.** Producing a strictly clean baseline now would need a checkout of the pre-arc code, and the recorded run is on the same corpus and scale. Per-leg scores were shown not to shift ranking when they landed, since the hit rates reproduced exactly. The delta therefore covers all three changes together, which is what this spec intends: they share a rebuild and are measured as one.

## Open Questions

None. All clarifications are resolved above.
