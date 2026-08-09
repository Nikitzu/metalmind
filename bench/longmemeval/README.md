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
node bench/longmemeval/run.mjs
```

The builder downloads 277 MB from HuggingFace (cached in
`~/.cache/metalmind-bench/longmemeval/`) and renders one markdown note per
unique session. `--oracle` swaps in the 15 MB evidence-only file: a fast
smoke fixture with no distractor haystack, useful for exercising the runner,
useless as a benchmark.

`run.mjs` builds an isolated vault, indexes it into its own collection, runs
every question, and drops the collection afterwards. `--limit N` truncates
the question set - note that the questions are grouped by type, so a small
limit samples one category rather than a cross-section.

Budget the index time. Chat sessions chunk far more heavily than vault
notes: roughly 1.25 s per session on a 12-core machine, so the full fixture
takes about seven hours, almost all of it embedding. Queries take a minute.

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
