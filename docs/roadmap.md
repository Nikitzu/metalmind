# Roadmap

> What's being worked on, what's next, and what isn't planned. Updated at each release.
>
> **Last updated:** 2026-08-16 · **Current release:** v0.21.0

metalmind is maintained by one person. This page exists so that's a known
quantity rather than a guess: you can see what's coming, what's stalled, and
what has been ruled out.

## Answered since this page last said otherwise

**Recall is now measured on data nobody here wrote.** This page used to name
third-party measurement as the standing objection. `bench/longmemeval/`
(v0.19.0) runs 500 human-labelled questions from an MIT dataset over a
3,000-session haystack, including 30 questions with no answer in the corpus at
all, and publishes the unflattering rows next to the good ones. v0.20.0 then
verified per-vault calibration on `xy-241/CS-Notes`, 683 notes written by
someone else. The objection is not fully closed, since neither is a real
working vault, but it is no longer true that every number comes from a corpus
metalmind generated.

**The adversarial benchmark ran, and hit@1 did not hold at 80%.** This page
asked for a number worth quoting and set the bar itself. The bar was missed.
`bench/adversarial-v0/` is 93 queries across five classes, written against this
vault by a model given no access to the retrieval code, so the phrasing was not
chosen to flatter it. Measured on `main` ahead of the next release:

| mode | hit@1 | hit@5 | MRR |
|---|---|---|---|
| hybrid | 55% | 85% | 0.65 |
| hybrid + rerank | 58% | 83% | 0.68 |

The aggregate hides the useful part. Per class, reranking gains 19 points on
queries that paraphrase around the note's own vocabulary and loses 15 on
choosing between two near-identical notes, where hybrid alone reaches 80% and
reranking drops it to 65%. That is why reranking is still opt-in rather than
the default. Worst class is vocabulary mismatch at 25% without reranking.

Four fixes landed against this since the first run (query-side embedding, a
supersede ordering constraint, model-derived vector width, and temporal intent
ordering) and LongMemEval is unchanged at 44/62/70, so none of them bought
their gains from the third-party benchmark. The near-duplicate gap under
reranking is not closed and is the open item below.

## Track record

76 releases since 2026-04-20. `CHANGELOG.md` carries the reasoning for each
one, not just the diff. Every performance claim on the site traces to a
harness in `bench/` you can run yourself.

That's the honest version of "will this be around": not a promise, but a
history you can check.

## Now (next 90 days)

**Close the near-duplicate gap under reranking.** The benchmark above found
the specific failure: a cross-encoder is good at judging whether a passage is
about the query, which is the wrong instrument for choosing between two notes
that are both about it and differ only in which supersedes the other. A
supersede ordering constraint recovered part of this and was not enough. Until
near-duplicates holds at 80% with reranking on, reranking cannot become the
default, and the number this page wanted to quote stays unquotable.

**Recall precision follow-ups.** Intent reranking landed as temporal intent
ordering. The branch-aware filter, deferred from the v0.9.0 external-repo-leverage
scope, has not been started.

**Temporal recall.** Supersede validity windows and `--as-of`, so a note can
answer "what was true when this was written" rather than only "is this
current". The natural sequel to the supersede work in v0.12.0.

## Next

- **Session metrics.** `session end --summary-stdin` as an explicit primitive; `/save` currently calls `atium add` directly.
- **Vault metrics.** Surface recall health over time rather than per query.
- **Scheduled ingest.** Auto-memory ingest on a timer instead of by hand.
- **Linux desktop parity.** `flare` and `routine eod` are macOS-only; Linux needs systemd + notify-send adapters.

## Not planned

Stating these saves everyone time.

- **A hosted service.** There is no metalmind backend, and adding one would break the property that makes the tool safe to depend on: nothing to shut down.
- **Wrapping codegraph.** Within-repo code intelligence belongs to [codegraph](https://github.com/colbymchenry/codegraph), which does it better. metalmind installs alongside it. See v0.15.0.
- **Re-adding a server backend.** The Qdrant + Ollama path was removed in v0.16.0 after the 50k benchmark showed in-process retrieval holds. Bringing back a daemon would need a benchmark showing the embedded stack fails, not a preference.
- **Morning routines.** Dropped by design: the end-of-day routine covers the carry-forward case.

## If this goes unmaintained

The vault is plain markdown in your own directory. Obsidian still opens it,
`grep` still searches it, `git` still versions it. `metalmind uninstall`
removes the tool and never touches your notes. MIT licensed, and the
architecture decisions are written down in `docs/` and `CHANGELOG.md`
specifically so someone else, or a future you, can pick it up.
