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
- `longmemeval_s` first (~40 sessions per question, union in the low
  thousands). `_m` scales the haystack, not the question set.

## Next step (separate work item, not this spike)

`bench/longmemeval/build-fixture.mjs`: download `longmemeval_s.json` from the
official HuggingFace repo, render sessions to markdown, emit `questions.json`
in the recall-at-scale format. Score with the shared hit@k / MRR / NDCG@5
reducers. Gate: no number ships to the site until the abstention column is
implemented - reporting hit rates while ignoring the questions designed to
have no answer would overstate recall.
