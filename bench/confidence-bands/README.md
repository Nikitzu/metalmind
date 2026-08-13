# Confidence bands on a real vault

Derives the threshold edges for a "how sure is this recall" signal, measured on
a working personal vault rather than a generated fixture.

## Why this exists separately from `bench/longmemeval`

LongMemEval established that fused RRF scores carry almost no confidence signal
(AUC 0.549) while raw cosine does (0.771 for the best score among the top 5).
It also produced a warning: no threshold on that corpus separated answerable
from unanswerable questions well enough to gate on. Catching two thirds of the
blanks cost a quarter of the real recalls.

That warning turned out to be corpus-specific, and the corpus was the wrong one.
LongMemEval sessions are chat transcripts. metalmind indexes prose notes. Cosine
distributions are shaped by the genre of the text, so an edge derived from
transcripts says little about an edge for a vault. Re-deriving on vault-shaped
data reversed the conclusion.

## Corpus and labels

- **Corpus:** a working personal vault, 330 notes across `Learnings/`, `Work/`,
  `Memory/`, `Plans/`, `Archive/` and `Daily/`. Real prose, real headings, real
  wikilinks, uneven note quality.
- **Negatives:** 80 LongMemEval questions run against that vault. They are
  third-party authored and out of domain, so nobody who maintains the vault
  wrote the negatives. Every negative scoring above the derived edge was read
  by hand to confirm it is genuinely unanswerable. All of them were: Spotify
  playlists, frequent-flyer status, a volleyball league record.
- **Positives, two sets, deliberately:**
  - `excerpt` (305): a body sentence sampled from each note with the title words
    stripped, used as the query, expecting that note. Nobody authors these and
    they scale, but the lexical overlap with the source note is heavy, so they
    are easier than real questions.
  - `manual` (30): natural questions written the way someone would actually ask,
    phrased away from the note's title wording.

Running both is the point. The excerpt set alone would have produced a
confident and wrong answer, as shown below.

## The vault is private

The result files record aggregate statistics only: scores, AUC, band edges, and
per-band shares. No note names, no snippets, no query text. The query sets are
built into `~/.cache/metalmind-bench/confidence-bands/` and are not committed.

## How to run

```sh
node bench/confidence-bands/build-queries.mjs
node bench/confidence-bands/run.mjs
```

`build-queries.mjs` needs the LongMemEval fixture already downloaded, since the
negatives come from it. `--vault <path>` points both scripts at a different
vault. Indexing 330 notes takes a few minutes, so unlike the LongMemEval runner
this one has no index-reuse machinery.

`manual.json` in the cache directory is created empty on first build and left
alone afterwards. The run works without it, reporting the excerpt set only.

## Results (2026-08-13, 330 notes)

| signal | AUC (excerpt) | AUC (manual) |
|---|---|---|
| fused (RRF) | 0.775 | 0.735 |
| semantic cosine, top hit | 0.929 | 0.765 |
| **semantic cosine, best of top-5** | **0.984** | **0.984** |
| BM25, top hit | 0.925 | 0.724 |
| BM25, best of top-5 | 0.993 | 0.777 |

Cosine best-of-top-5 reaches 0.984 on a real vault, against 0.771 on the
transcript corpus and 0.804 for the cross-encoder there. The signal is far
stronger on the genre metalmind actually indexes.

**Only cosine survives contact with the harder positive set.** BM25 looks like
the best signal on excerpt queries (0.993) and collapses on natural ones
(0.777), which is exactly the lexical-overlap bias the excerpt protocol was
expected to have. Cosine scores 0.984 on both. Had this run used one positive
set, it would have recommended BM25 and been wrong.

### Band edges

The high edge is the 90th percentile of negatives, the low edge the 10th
percentile of positives. Cosine best-of-top-5 is the only signal where the low
edge sits above the high edge on both positive sets, meaning the classes
separate rather than overlap:

| signal | low edge (excerpt) | low edge (manual) | high edge | separated |
|---|---|---|---|---|
| semantic cosine, best of top-5 | 0.6952 | 0.6983 | 0.6438 | yes |

The two positive sets agree on the low edge to three decimal places while
differing wildly in difficulty (hit@1 70% for excerpt against 33% for manual).
An edge that is stable across that gap is measuring the corpus, not the query
style.

Band occupancy at those edges:

| | below low | middle | above high |
|---|---|---|---|
| positives (manual) | 0% | 10% | 90% |
| negatives | 89% | 8% | 4% |

Nine of 80 negatives clear the high edge. Reading them confirmed all nine are
genuinely unanswerable, so they are true false positives at this threshold
rather than mislabelled data.

## What this does and does not license

It licenses a reported confidence on vault-shaped corpora, and unlike the
LongMemEval result it is strong enough that a gate is defensible: 90% of real
answers sit above the edge while 89% of out-of-domain questions sit below it.

It does not license hardcoding 0.64 and 0.70 into the tool. This is one vault,
one embedder, 80 negatives, and 30 natural positives. Cosine distributions move
with the embedding model, so the edges are tied to the current default embedder
and would have to be re-derived if it changes. A second vault should be measured
before any constant ships.

The `manual` hit@1 of 33% understates retrieval quality: each question is
labelled with a single expected note, and a vault this dense often has other
notes that answer the question just as well. It is reported for context, not as
a retrieval result.
