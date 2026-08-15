# adversarial-v0

Queries built to break recall rather than flatter it, run against the real vault.

## What this is

93 hand-authored questions across five classes, each a hypothesis about how
retrieval fails. Unlike the other harnesses there is no fixture and no indexing
step: the corpus is the vault you actually use, already indexed by the running
watcher. That makes a run take seconds.

```sh
node bench/adversarial-v0/run.mjs
node bench/adversarial-v0/run.mjs --rerank --class negation-and-absence --json
```

| env | default |
|---|---|
| `METALMIND_BENCH_ENDPOINT` / `METALMIND_RECALL_HTTP` | `http://127.0.0.1:17317` |
| `VAULT_PATH` | `~/Knowledge`, used only to verify expected stems exist |

## Who wrote the questions, and why that matters

An adversarial benchmark is trivially gameable by whoever writes it. Someone who
knows the fusion weights, folder penalties and per-file cap will write questions
the system happens to handle, score 90%, and report a number that means nothing.

So the questions were written by a separate agent with no access to the metalmind
repository. It read only the vault, never ran a search, and never saw a result.
It could not tune a query until it passed, because it never learned whether any
query passed.

That removes the specific leak. It does not make the set independent: the author
was the same model family as the maintainer's assistant, so shared blind spots
about what counts as "hard" survive. Weaker than questions written by the vault's
owner, stronger than questions written by whoever wrote the ranking code.

Every query carries a `why_adversarial` line. Unjustified queries are how an
adversarial bench quietly becomes a flattering one.

## The five classes

| class | what it tests |
|---|---|
| `vocabulary-mismatch` | query shares no distinctive words with the target |
| `competing-near-duplicates` | two notes cover one topic, one superseded or archived |
| `distinguishing-detail` | several similar notes, the query turns on one particular |
| `temporal` | most recent, earliest, before, after |
| `negation-and-absence` | what was ruled out, dropped, not supported |

## Not a gate

Results drift as you write notes, so no number here ships to the site and no
release is blocked on it. The score is a summary; the miss list is the point. A
class scoring 30% says nothing on its own, while seeing that every miss returned
the superseded note says exactly what to fix.

Each run records the vault's git commit, because a number measured on a live
corpus is unreproducible without it.

`run.mjs` refuses to start if any `expected` stem no longer resolves. Notes get
renamed and archived under this bench, and a stale stem would otherwise score as
a retrieval failure forever.

## Baseline, 2026-08-15

Vault at 375 notes, hybrid, no rerank.

| class | n | hit@1 | hit@3 | hit@5 | MRR | misses |
|---|---|---|---|---|---|---|
| vocabulary-mismatch | 16 | 25% | 69% | 75% | 0.42 | 4 |
| competing-near-duplicates | 20 | 80% | 90% | 95% | 0.86 | 1 |
| distinguishing-detail | 21 | 62% | 81% | 90% | 0.73 | 2 |
| temporal | 15 | 27% | 60% | 67% | 0.44 | 5 |
| negation-and-absence | 21 | 52% | 62% | 81% | 0.61 | 4 |
| **all** | 93 | **52%** | **73%** | **83%** | **0.63** | 16 |

Two predictions the first run falsified. Negation was expected to collapse and
came in mid-table, because BM25 carries it where embeddings cannot. And
`competing-near-duplicates` was expected to expose the supersede and folder
penalties as weak; it is the strongest class by a distance, which is the first
evidence those penalties work outside unit tests.

The headline is that **hit@5 sits far above hit@1 in every weak class**. The
right note is nearly always retrieved and merely ranked below something else, so
these are ranking failures rather than recall failures.

See `specs/structural-signals-as-constraints.md` for what the first run led to.
