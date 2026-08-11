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
| `--keep-index` | leave the collection on disk after the run and write a manifest beside it |
| `--reuse-index` | skip indexing and query the kept collection. Implies `--keep-index`. Refuses to run if the kept index covers a different session set than the current flags ask for, so a changed `--scale` cannot silently query the wrong haystack |

Indexing dominates the runtime and does not change between retrieval
experiments, so anything that varies only the scoring or ranking side should
index once with `--keep-index` and then iterate with `--reuse-index`.

Budget the time honestly, because chat sessions are far heavier than the
HN-comment corpus that the other benches use:

- **Indexing:** about 1.3 s per session on a 12-core machine. 3,000
  sessions took 66 minutes; the full 19,195 would take roughly seven hours.
- **Plain queries:** ~0.2 s each, so a couple of minutes for all 500.
- **Rerank queries:** about **7.6 s each** (plus a one-time ~500 MB model
  download and a ~30 s first-call load). A full 500-question rerank pass is
  another hour on top of indexing.

## Results to date

`--scale 3000 --rerank`, 500 questions, 470 answerable (2026-08-11):

| type | n | hit@1 | hit@1 rr | hit@5 | hit@5 rr |
|---|---|---|---|---|---|
| single-session-assistant | 56 | 91% | 96% | 100% | 100% |
| knowledge-update | 72 | 54% | 79% | 89% | 94% |
| multi-session | 121 | 27% | 39% | 59% | 70% |
| temporal-reasoning | 127 | 23% | 28% | 64% | 63% |
| single-session-user | 64 | 17% | 42% | 61% | 63% |
| single-session-preference | 30 | 13% | 7% | 23% | 20% |
| **all answerable** | 470 | **36%** | **47%** | **68%** | **71%** |

The spread is the finding, not the average. Where the task is "find the
session where this was discussed", retrieval is strong. Where it needs a
fact extracted from an implicit mention, or synthesis across sessions, it
is weaker - the boundary the mem0 evaluation predicted, now with numbers.

Reranking answers the open question from the first run: the hit@1 shortfall
was substantially a **ranking** problem, not a retrieval one. It recovers
about a third of the gap for 38x the latency (7.6 s per query against 0.2 s).
It is not uniformly good, though - `single-session-preference` gets *worse*
under reranking, so the cross-encoder actively demotes the right session when
the evidence is an implicit aside.

Still open: what the full 19,195-session haystack costs relative to this 3k
slice.

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

The measure is **AUC**: the probability that a random answerable question
outscores a random unanswerable one. 0.5 is no signal at all; 1.0 is perfect
separation. Threshold-accuracy is deliberately not reported - with 470
answerable questions against 30 unanswerable, "always answerable" already
scores 94%, which looks informative and is noise.

**Fused scores carry no signal; reranked scores do.** The signal comparison
below shows that raw retriever scores do too, which changes what follows from
this.

| | AUC | answerable p50 | unanswerable p50 |
|---|---|---|---|
| hybrid (RRF) | 0.549 | 0.126 | 0.128 |
| + cross-encoder | 0.804 | 0.798 | 0.061 |

RRF at 0.549 is a coin flip, and the cause is structural rather than
tuning: it fuses by rank position, so the top hit earns roughly the same
fused score whether it is a bullseye or the least-bad of a bad lot.
Similarity magnitude is discarded during fusion. The cross-encoder keeps
it, which is why the same questions separate at 0.804.

The consequence is a product one: in its default mode `tap copper` cannot
say "the vault does not contain this", and neither can an agent reading its
output.

## The signal comparison table

That result raised an obvious follow-up: if fusion is what destroys the
magnitude, do the raw retriever scores still carry it? Every hybrid hit now
carries `sem_score` and `kw_score` - each leg's own score for that document,
or null when the leg did not return it - so the same run can compute AUC
against several candidate confidence signals at once. Ranking is untouched;
only the number a caller would threshold on changes.

`prev_score` is not usable for this. It holds whichever leg saw the document
first, so it is cosine for some hits and BM25 for others, and comparing
across hits compares two different units.

Both classes coerce a missing score to 0. An earlier version of
`scoreAbstention` dropped missing values on the answerable side while mapping
them to 0 on the unanswerable side, which discards the answerable side's worst
cases and inflates AUC.

Measured on the same 3,000-session run (2026-08-11), identical hit rates, so
the only thing that varies below is which number a caller reads:

| signal | AUC | answerable p50 | unanswerable p50 |
|---|---|---|---|
| fused (RRF) | 0.549 | 0.126 | 0.128 |
| BM25, top hit | 0.649 | 24.11 | 20.71 |
| semantic cosine, top hit | 0.696 | 0.751 | 0.697 |
| BM25, best of top-5 | 0.697 | 27.86 | 21.69 |
| semantic cosine, best of top-5 | **0.771** | 0.781 | 0.730 |
| cross-encoder (reference) | 0.804 | 0.798 | 0.061 |

The magnitude survives retrieval and is destroyed by fusion, not by the
embedder. Best-of-top-5 cosine beats the score of the top hit alone, which
fits the question being asked: "is anything in this vault a good match",
not "is the document fusion happened to rank first a good match".

An offline sweep over the saved per-question records found that adding a
capped BM25 term (`semMax + 0.1 * min(kwMax / 50, 1)`) reaches AUC 0.791.
That is 0.02 over cosine alone against 30 unanswerable questions, which is
inside the noise, so it is recorded rather than adopted.

**The consequence for the reranker is the surprise.** A signal that is already
computed, and free, recovers most of the separation the cross-encoder was
buying at 7.6 s per query. The reranker's ranking value (+11pp hit@1) is
unaffected and still real; its *confidence* value is now close to redundant.

### Do not turn this into a gate

AUC measures ranking, not whether a usable threshold exists. It does not,
at least not for suppression:

| cosine best-of-5 threshold | unanswerable caught | answerable wrongly suppressed |
|---|---|---|
| 0.65 | 13% | 1% |
| 0.70 | 27% | 7% |
| 0.74 | 63% | 26% |
| 0.78 | 87% | 50% |

Catching two thirds of the blanks costs a quarter of the real recalls. For a
memory tool that trade is bad in the direction that matters, so the signal
belongs in the output as a reported confidence, left for the caller to weigh,
rather than as a rule that hides results.

Two caveats bound how far these numbers travel. There are only 30 unanswerable
questions, so every operating point above is noisy. And cosine distributions
are corpus-shaped: a threshold derived from chat transcripts does not transfer
to a prose vault, so band edges have to be re-derived on vault-like data before
anything ships.

One independent check that the signal tracks correctness and not just
answerability: hit@1 among the questions kept rises from 36% to 44% as the
threshold climbs. The score is picking out queries the retriever got right,
not merely queries that had an answer somewhere.

A note on how this metric was first written, since it nearly buried the
finding: the original version derived a floor from the 5th percentile of
answerable scores and reported the fraction of unanswerable questions
below it. The reranked distribution has a long left tail (p05 = 0.011), so
that floor sat *below* most unanswerable scores and reported 13% for a
distribution separating 13x at the median. A threshold-free measure was the
right choice from the start.
