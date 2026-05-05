# recall-at-scale — recall quality + latency at 1k / 10k / 50k

> Benchmark for the **memory** module of the [metalmind standard library](../../README.md#whats-in-the-standard-library) — at scale.

Sister bench to [`bench/recall-v0/`](../recall-v0/). Where `recall-v0` answers
"is recall any good on a hand-authored 12-note vault?", `recall-at-scale`
answers **"does the embedded sqlite-vec + fastembed stack hold up when the
vault has 50k notes of plausible noise?"**

If the small-vault numbers in `recall-v0` are right but this one collapses,
the embedded-default thesis breaks and `--legacy` shouldn't be removed.

## Results to date

Embedded backend (sqlite-vec + fastembed `BAAI/bge-small-en-v1.5`, 384-dim),
hybrid mode, no rerank, on a 16-thread M-series Mac:

| scale | hit@1 | hit@3 | hit@5 | misses | index (s) | p50 (ms) | p95 (ms) |
|---|---|---|---|---|---|---|---|
| 1,000 | 100% | 100% | 100% | 0/20 | 33 | 12 | 24 |
| 10,000 | 100% | 100% | 100% | 0/20 | 1226 | 40 | 67 |
| 50,000 | _pending — indexer takes ~100 min, run with `--scales 50000` separately_ |

Both small scales hit the same 100% top-1 — the embedded retrieval pipeline
holds up cleanly at 10× the recall-v0 corpus size with sub-100 ms p95
latency. 50k results land in a follow-up; the framework is here, the
indexer just needs an unattended hour.

## Methodology

- **Corpus**: Hacker News comments fetched from the public Algolia mirror
  (`hn.algolia.com/api/v1/search?tags=comment`). Each comment becomes one
  markdown note with frontmatter (`story_id`, `story_title`, `author`,
  `created_at`). One-time fetch cached at `~/.cache/metalmind-bench/hn/`,
  outside the repo so we don't bloat git.
- **Gold**: `seed-gold.mjs` deterministically picks 20 stories with ≥5
  cached comments. For each picked story, the query is a templated
  paraphrase of the story title (`"discussion of <title>"`, `"comments on
  <title>"`, etc.) and **expected = every cached comment on that story**.
  Honest framing: this is "give me anything from the thread about X",
  which is what real vault recall looks like.
- **Scale loop**: per scale N ∈ {1000, 10000, 50000}, the runner assembles
  an isolated tmp vault (gold comments + first N−|gold| filler comments
  from the cache), spawns a dedicated watcher on an isolated port, indexes
  one-shot, runs the 20 questions, writes `results/recall-at-scale-<ts>.md`,
  tears down the watcher and tmp vault even on Ctrl-C.
- **Defaults**: `mode=hybrid`, `K=5`, `rerank=false`. Pass `--rerank` to add
  cross-encoder rescore (≈+5pp on hit@5 for ~2 s per query — orthogonal
  knob, same trade as `recall-v0`).

## How to run

```sh
# One-time corpus fetch (~10 min for 50k on a normal connection)
node bench/recall-at-scale/scripts/fetch-hn.mjs --n 50000 --story-min 5

# Re-seed the gold question set (deterministic, seed=42 by default)
node bench/recall-at-scale/scripts/seed-gold.mjs --k 20

# Run all three scales (default)
node bench/recall-at-scale/run.mjs

# Or one scale at a time during dev
node bench/recall-at-scale/run.mjs --scales 1000

# Optional: rescore the hybrid result list with a cross-encoder
node bench/recall-at-scale/run.mjs --scales 1000,10000 --rerank
```

The runner exits non-zero if `min hit@5` across scales falls below `40%`
— the gate is intentionally loose because this bench is about scale
behavior, not query craft (queries are mechanical paraphrases, not
hand-tuned). Ratchet upward once the numbers stabilize.

## Why HN comments

- Free, no auth, no PII gating worse than what HN itself publishes.
- Topically diverse — a real vault has many subjects, not one.
- Comments have meaningful length variance (≈100 to 5000 chars), which
  exercises the chunker.
- Story-IDs give us a natural many-to-one gold mapping that mirrors how
  users actually recall ("anything from that thread about X" rather than
  "this exact line").

The honest limit: HN comments are conversational, not your notes. Numbers
here are floor estimates — your own vault should be at least this
recoverable, usually better, since you wrote it for retrieval.

## Reading the table

| column | meaning |
|---|---|
| `scale` | total notes in the tmp vault for that run |
| `hit@1` | fraction of 20 questions where the top-1 hit is from the gold thread |
| `hit@3` / `hit@5` | same for top-3 / top-5 |
| `misses` | questions with 0 gold-thread hits in top-K |
| `index (s)` | wall-clock indexer time (one-shot) |
| `p50 (ms)` / `p95 (ms)` | per-query latency, median and 95th percentile |

## Honest comparison vs recall-v0

`recall-v0` reports hit@1 = 85% at 1000 notes; this bench reports lower
hit@1 on the same scale. Two differences make those numbers
**not directly comparable**:

- `recall-v0` queries are **hand-crafted to share keywords with the
  expected gold**. `recall-at-scale` queries are **mechanically paraphrased
  from story titles** — they don't necessarily appear in the gold body.
- `recall-v0` has **one gold per query**. `recall-at-scale` has **~22 gold
  per query** (every comment on the thread). That makes hit@5 easier but
  hit@1 harder, because top-1 has to come from that specific thread amid
  many other plausibly-relevant comments.

The right way to read the two together: `recall-v0` measures **best-case
recall on curated notes** (closer to a power user's vault). `recall-at-scale`
measures **floor-case recall on noisy text at scale** (closer to "any
markdown corpus you point me at"). Both numbers should hold up;
divergence between them tells us where the system is fragile.
