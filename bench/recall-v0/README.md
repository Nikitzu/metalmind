# recall-v0 — baseline recall bench

Measures hit@K and latency of the HTTP recall endpoint (`/search`) against a
tiny, hand-authored fake vault (12 notes, ~1 KB each) about a fictional drone
company. Zero PII, zero real internal content.

## Why

Two questions the README makes and we haven't measured:

1. **Latency** — is `/search` actually sub-100 ms cold / sub-20 ms warm?
2. **Recall quality** — does the out-of-the-box embedder find the right note
   for realistic, paraphrased questions? (20 questions in `questions.json`,
   mix of exact-keyword and semantic-paraphrase.)

Not a claim on large vaults. 12 notes is a unit-level smoke, not a load test.

## Bootstrap

The bench talks to whatever `metalmind-vault-rag-watcher` is running on
`METALMIND_RECALL_HTTP` (defaults to `http://127.0.0.1:17317`). Two options:

**A — Dedicated bench vault (recommended).**

```sh
export BENCH_VAULT="$(pwd)/bench/recall-v0/fake-vault"
VAULT_PATH="$BENCH_VAULT" metalmind-vault-rag-indexer
VAULT_PATH="$BENCH_VAULT" metalmind-vault-rag-watcher &
# wait a second for the embed to settle
node bench/recall-v0/run.mjs
```

**B — Point the bench at an existing watcher.** Copy the 12 notes into your
vault's `Inbox/` (or a dedicated folder), let the watcher reindex, then:

```sh
node bench/recall-v0/run.mjs
```

Either way the runner reads `METALMIND_RECALL_HTTP` (fallback
`127.0.0.1:17317`) and writes a timestamped JSON + Markdown report into
`bench/recall-v0/results/`.

## Knobs

| env | default | meaning |
| --- | --- | --- |
| `METALMIND_BENCH_ENDPOINT` | `$METALMIND_RECALL_HTTP` → `http://127.0.0.1:17317` | Recall endpoint base URL. |
| `METALMIND_BENCH_K` | `5` | Top-K to request and score against. |
| `METALMIND_BENCH_TIMEOUT_MS` | `8000` | Per-query timeout. Bumped to ≥180s automatically when `--rerank` is set (first call downloads ~500 MB). |
| `METALMIND_BENCH_VAULT` | unset | Recorded in the report's meta block for traceability. |
| `METALMIND_BENCH_RERANK=1` / `--rerank` | off | Flip the runner into rerank mode — asks the server to cross-encode the top-N and return a re-sorted top-K. Useful to measure the hit@1 lift. |

## Exit code

- `0` — hit@5 ≥ 60%
- `1` — hit@5 < 60% (useful as a regression gate)
- `2` — runner error

## Updating questions

Edit `questions.json`. Each entry:

```json
{ "id": "Q21", "query": "...", "expected": ["note-file.md"], "tags": [] }
```

`expected` is a list of basenames (any one match = hit). Tags are freeform —
use them to filter per-category rates in post-hoc analysis.
