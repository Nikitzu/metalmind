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

**The adversarial benchmark ran, missed its bar, and the miss turned out to be
a bug.** This page asked for a number worth quoting and set the bar itself:
hit@1 holding at 80%. `bench/adversarial-v0/` is 93 queries across five
classes, written against this vault by a model given no access to the
retrieval code, so the phrasing was not chosen to flatter it. The first run
came back at 55% hybrid and 58% reranked, with reranking gaining 19 points on
paraphrased queries and losing 15 on choosing between near-identical notes.

That trade looked intrinsic to cross-encoders and was written up as such. It
was not. Tracing all 20 regressions showed every one was a sibling swap, and
two defects explained them: the reranker was scored against chunk text with no
note title attached, so on four of five traced cases the token that identified
the right note was invisible to it, and it then sorted on its own score alone,
discarding the BM25 evidence that had put the note in the candidate set. A
third defect surfaced while fixing those, in date ordering, which had been
silently depending on the numeric scale of whatever ran before it.

Measured on `main` ahead of the next release:

| mode | hit@1 | hit@5 | MRR | near-duplicates |
|---|---|---|---|---|
| hybrid | 55% | 83% | 0.65 | 80% |
| hybrid + rerank | 63% | 89% | 0.73 | 85% |

Reranking is now better than hybrid on every one of the five classes, and
near-duplicates clears the 80% bar. On LongMemEval the same change takes hit@1
from 44% to 49% and MRR from 0.54 to 0.59, which matters more than the
adversarial number because those 500 questions are human-labelled and written
by someone else. Worst class remains vocabulary mismatch at 25% without
reranking.

**A benchmark harness was measuring the wrong build.** `bench/longmemeval/run.mjs`
started its watcher by name and inherited `PATH`, which on the development
machine resolved to an installed copy several versions behind the checkout. A
full 500-question run completed against code that did not contain the change
being tested, and reported clean. `/health` now returns the version and module
path, and the harness refuses to run against a build outside the checkout
unless told to. Results filed before that guard cannot be assumed to describe
the code they sit next to.

## Track record

76 releases since 2026-04-20. `CHANGELOG.md` carries the reasoning for each
one, not just the diff. Every performance claim on the site traces to a
harness in `bench/` you can run yourself.

That's the honest version of "will this be around": not a promise, but a
history you can check.

## Now (next 90 days)

**Decide whether reranking becomes the default.** The retrieval-quality
argument against it is gone; what remains is cost. Reranking adds a
cross-encoder pass to every query and needs the `[rerank]` extra plus a 150 MB
model, so this is a latency and install-footprint decision rather than an
accuracy one. Two small regressions are on the record against it: on
LongMemEval, preference questions lose hit@5 and assistant questions lose one
question, the only two types that move backwards.

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
