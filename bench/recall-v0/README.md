# recall-v0 — recall quality + latency bench

Measures hit@K and latency of the HTTP recall endpoint (`/search`) against a
fictional drone-company vault. Two modes:

- **Single-scale** (default) — 12 hand-authored gold notes, talks to whatever
  watcher is already running. Unit-level smoke.
- **Multi-scale** (`--scales`) — runner owns the lifecycle. For each scale N
  it assembles an isolated tmp vault (12 gold + first N−12 distractors),
  spawns a dedicated watcher on an isolated port + Qdrant collection,
  indexes, queries, tears down. Reports hit@K as a function of vault size.

Zero PII, zero real internal content. Distractors are synthetic Quillfly
(fictional) ops notes that do not match any question.

## Why

Three questions:

1. **Latency** — is `/search` actually sub-100 ms cold / sub-20 ms warm?
2. **Recall quality at scale** — does the embedder still find the right note
   when the vault has 100 / 500 / 1000 notes of plausible same-domain noise?
3. **Recall quality baseline** — on the 12-note smoke set, how many of 20
   realistic questions (mix of keyword and paraphrase) find the target?

## Multi-scale (recommended)

```sh
# Generate the 1000 distractor notes once (checked into repo already):
node bench/recall-v0/scripts/gen-distractors.mjs --n 1000 --seed 42

# Run the scaled bench:
node bench/recall-v0/run.mjs --scales 12,100,500,1000
```

The runner:

- assembles a tmp vault at `mktemp -d` with 12 gold + first N−12 distractors;
- spawns `metalmind-vault-rag-indexer` then `metalmind-vault-rag-watcher` with:
  - `VAULT_PATH=<tmp>`
  - `VAULT_COLLECTION=metalmind_bench_recall_v0_<N>`
  - `VAULT_HTTP_PORT=17400` (override with `--port`)
- waits for `/search` to come up, runs the 20 questions;
- **tears down on every exit path** (success, error, Ctrl-C, crash):
  kills the watcher, drops the Qdrant collection, removes the tmp vault.

Your real vault (at `~/Knowledge`) and real collection (`vault` on port
17317) are never touched. Run it a hundred times a day; it leaks nothing.

### Prerequisites

- Qdrant reachable at `$VAULT_QDRANT_URL` (default `http://localhost:6333`).
- `metalmind-vault-rag-indexer` + `metalmind-vault-rag-watcher` installed from
  this repo's `packages/vault-rag/` (the watcher must honor `VAULT_HTTP_PORT`
  — versions ≥ 0.2.10). Reinstall from local source with:

  ```sh
  uv tool install --force --reinstall ./packages/vault-rag
  ```

## Single-scale (legacy / quick smoke)

Talks to whatever watcher is already running on `METALMIND_RECALL_HTTP`
(defaults to `http://127.0.0.1:17317`). Two options:

**A — Dedicated bench vault.** Point the watcher at the 12 gold notes:

```sh
export BENCH_VAULT="$(pwd)/bench/recall-v0/fake-vault"
VAULT_PATH="$BENCH_VAULT" metalmind-vault-rag-indexer
VAULT_PATH="$BENCH_VAULT" metalmind-vault-rag-watcher &
node bench/recall-v0/run.mjs
```

**B — Point at existing watcher.** Copy the 12 notes into your vault's
`Inbox/`, let the watcher reindex, then:

```sh
node bench/recall-v0/run.mjs
```

**B will pollute your real vault's collection** with 12 drone-company notes.
Prefer multi-scale mode for any serious run.

## Knobs

| env / flag | default | meaning |
| --- | --- | --- |
| `--scales 12,100,500,1000` | — | Run multi-scale mode with these note counts. |
| `--port <N>` | `17400` | Port for the bench-spawned watcher (multi-scale only). |
| `--rerank` / `METALMIND_BENCH_RERANK=1` | off | Ask the server to cross-encode top-N and re-sort. First call downloads ~500 MB; timeout bumps to ≥180s automatically. |
| `METALMIND_BENCH_ENDPOINT` | `$METALMIND_RECALL_HTTP` → `http://127.0.0.1:17317` | Single-scale endpoint. Ignored in multi-scale. |
| `METALMIND_BENCH_K` | `5` | Top-K to request and score against. |
| `METALMIND_BENCH_TIMEOUT_MS` | `8000` | Per-query timeout. |
| `VAULT_QDRANT_URL` | `http://localhost:6333` | Qdrant base URL. Runner hits `DELETE /collections/<name>` on teardown. |

## Exit code

- `0` — hit@5 ≥ 60% (at the largest scale, in multi-scale mode)
- `1` — hit@5 < 60% (regression gate)
- `2` — runner error

## Distractor generator

`scripts/gen-distractors.mjs` is seeded and deterministic. Same `--seed`
produces byte-identical output. 16 topic templates (warehouse inventory,
travel approvals, vendor contracts, sprint retros, OKR check-ins, firmware
notes, QA logs, privacy reviews, marketing plans, support macros, RFCs,
platform notes, policies, project updates, CI notes) — all plausible
same-domain Quillfly content, none overlapping with the 12 gold notes'
subjects. Filenames `distractor-0001.md` … `distractor-1000.md` are sorted,
so `--scales 100` and `--scales 500` share a prefix.

Regenerate with a different count or seed:

```sh
node bench/recall-v0/scripts/gen-distractors.mjs --n 2000 --seed 7
```

## Updating questions

Edit `questions.json`. Each entry:

```json
{ "id": "Q21", "query": "...", "expected": ["note-file.md"], "tags": [] }
```

`expected` is a list of basenames (any one match = hit). Tags are freeform.

## Limitations

- **Questions authored by the tool author.** Confirmation-bias risk. A
  held-out set is not yet in place.
- **One embedder.** Whatever the watcher is configured for. No embedder sweep.
- **Distractors are same-domain.** That is by design — off-domain noise (e.g.
  Wikipedia paragraphs) produces trivially easy benchmarks. Same-domain noise
  is what gold competes against in real vaults.
- **One run per query.** Latency reports single-shot values, not p50/p95/p99
  across N repetitions. Added to the follow-up list.
- **No baseline (BM25, grep, competitors).** The hit@K numbers are our own
  floor, not a comparison. Also follow-up.
