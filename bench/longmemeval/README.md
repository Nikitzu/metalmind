# LongMemEval fixture - spike verdict: KEEP

> Status: verdict only, no harness yet. Spiked 2026-08-09, time-boxed to one day.
> This doc exists so the decision does not get relitigated - the mem0 evaluation
> (`Learnings/mem0-vs-metalmind-shape-mismatch` in the maintainer vault) is the
> cautionary example of deciding the same thing twice.

## What was evaluated

[LongMemEval](https://github.com/xiaowu0162/LongMemEval) (MIT, 500 questions)
as a third-party fixture for the recall bench, partially answering the standing
objection that every published number is measured on corpora metalmind
generated.

## Why it maps (unlike mem0)

mem0 failed the shape test because its storage unit (extracted fact-strings)
has no file identity. LongMemEval passes it:

- Sessions have stable ids and can be rendered one-file-per-session
  (`<session_id>.md`, turns as sections). The vault is the union of all
  haystack sessions, deduplicated by id - same single-vault shape as
  `recall-at-scale`, no per-question reindexing.
- Every question carries `answer_session_ids` - human-labelled evidence
  sessions. That is exactly the `expected` file list, the same trick as the
  story-id derivation in `recall-at-scale` but with labels made by someone
  who is not the maintainer.
- All six question categories keep a measurable retrieval sub-task: did the
  evidence sessions surface. Answer *generation* (temporal reasoning,
  knowledge updates) is out of scope for a retrieval bench and stays out.
- Abstention questions have no evidence sessions - they map to "expect no
  hit above the weak-hit floor", which the recall-audit classifier already
  defines. A free negative-control column.

## Known limitations to state up front

- Sessions are chat transcripts, not notes. The corpus is third-party but the
  genre is not vault-like. This complements, not replaces, the real-vault
  benchmark (P0.1) - a transcript corpus cannot answer how recall behaves on
  wiki-style prose with headings and wikilinks.
- `longmemeval_s` (cleaned) is the corpus: 500 questions over 19,195 unique
  sessions. `_m` scales the haystack, not the question set.
- The upstream `xiaowu0162/longmemeval` repo is deprecated in favour of
  `longmemeval-cleaned`, which removes noisy history sessions that
  interfered with answer correctness. The fixture builder points at the
  cleaned repo.

## How to run

```sh
node --max-old-space-size=8192 bench/longmemeval/build-fixture.mjs
node bench/longmemeval/run.mjs --scale 3000
```

The builder downloads 277 MB from HuggingFace (cached in
`~/.cache/metalmind-bench/longmemeval/`) and renders one markdown note per
unique session: 19,195 sessions, 500 questions, 882 of those sessions
carrying evidence. `--oracle` swaps in the 15 MB evidence-only file, a
smoke fixture with no distractor haystack - useful for exercising the
runner, useless as a benchmark.

`run.mjs` builds an isolated vault, indexes it into its own collection, runs
every question, and drops the collection afterwards.

| flag | effect |
|---|---|
| `--scale N` | sample the haystack to N sessions, keeping **every** evidence session so all questions stay answerable. Only distractor density varies, and the result file records the size |
| `--rerank` | run each question twice, plain and with the cross-encoder, and report both tables. Refuses to start if the `[rerank]` extra is missing rather than silently reporting embedder ordering |
| `--limit N` | truncate the question set. Questions are grouped by type, so a small limit samples one category rather than a cross-section - it is a plumbing check, not a measurement |
| `--index-hours H` | indexer timeout, default 12 |

Budget the time honestly, because chat sessions are far heavier than the
HN-comment corpus that the other benches use:

- **Indexing:** about 1.3 s per session on a 12-core machine. 3,000
  sessions took 66 minutes; the full 19,195 would take roughly seven hours.
- **Plain queries:** ~0.2 s each, so a couple of minutes for all 500.
- **Rerank queries:** about **7.6 s each** (plus a one-time ~500 MB model
  download and a ~30 s first-call load). A full 500-question rerank pass is
  another hour on top of indexing.

## Results to date

`--scale 3000`, plain hybrid, no rerank (2026-08-09):

| type | n | hit@1 | hit@5 | MRR |
|---|---|---|---|---|
| single-session-assistant | 56 | 91% | 100% | 0.95 |
| knowledge-update | 72 | 54% | 89% | 0.68 |
| multi-session | 121 | 27% | 59% | 0.39 |
| temporal-reasoning | 127 | 23% | 64% | 0.37 |
| single-session-user | 64 | 17% | 61% | 0.34 |
| single-session-preference | 30 | 13% | 23% | 0.17 |
| **all answerable** | 470 | **36%** | **68%** | 0.47 |

The spread is the finding, not the average. Where the task is "find the
session where this was discussed", retrieval is strong. Where it needs a
fact extracted from an implicit mention, or synthesis across sessions, it
is weak - the boundary the mem0 evaluation predicted, now with numbers.

Two open questions for the next run: whether the reranker closes the
36%-to-68% gap between hit@1 and hit@5, and how much the full 19k haystack
costs relative to this 3k slice.

## Reading the abstention column

Abstention questions have no correct evidence in the corpus. A retrieval
stack cannot literally abstain, but a caller can, if the score distribution
separates. The floor is derived from the data - the 5th percentile of
answerable questions' top scores - rather than hardcoded, so the metric
measures separation rather than a chosen constant. A correct-abstain rate
near the floor percentile itself means no separation at all.

Publishing gate: hit rates never ship to the site without this column
beside them. Reporting recall while ignoring the questions designed to have
no answer would overstate the tool.

**First result: there is no separation.** At `--scale 3000`, the 30
abstention questions produced a top-hit score median of 0.1277 against
0.1256 for answerable ones - marginally *higher*, so the score carries no
signal about whether an answer exists at all. The cause is structural
rather than tuning: RRF fuses by rank position, so the top hit earns
roughly the same fused score whether it is a bullseye or the least-bad of a
bad lot. Similarity magnitude is discarded during fusion.

The consequence is a product one, not a benchmark one: `tap copper` cannot
say "the vault does not contain this", and neither can an agent reading its
output. The underlying embedder score survives on each hit as `prev_score`,
and cross-encoder scores span a far wider range than RRF's narrow band, so
a confidence signal is buildable. It has not been built.
