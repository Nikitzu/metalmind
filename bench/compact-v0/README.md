# compact-v0: recall-output token bench

> Benchmark for the `--compact` flag of the [metalmind standard library](../../README.md#whats-in-the-standard-library) memory module.

Measures the per-recall payload tax: the output tokens billed every time an agent runs `tap copper`, rendered two ways over the same query set.

- **verbose**: the CLI default (full JSON dump per hit, including prev_score)
- **compact**: `--compact` (lean per-hit envelope with a snippet-truncated body)

Unlike [`mcp-tax-v0`](../mcp-tax-v0/) (which measures the standing schema tax, already zero for metalmind), this measures what each individual recall costs the context window.

## The drift gate

`--compact` is display-only, so the set of files returned must be identical between modes. The runner asserts this per query and refuses to report a saving if retrieval drifted; a saving only counts when the returned file set is byte-identical. This is the honesty guarantee behind the "roughly 74% fewer recall-output tokens" claim in the 0.9.1 release notes.

## Token counting

Same approach as `mcp-tax-v0`: the Anthropic `/v1/messages/count_tokens` endpoint when `ANTHROPIC_API_KEY` is set, a chars/4 approximation otherwise (`--offline` forces it).

## Usage

```bash
node bench/compact-v0/run.mjs                       # offline approximation, fast tier
ANTHROPIC_API_KEY=sk-ant-... node bench/compact-v0/run.mjs
node bench/compact-v0/run.mjs --tier deep --k 5
METALMIND_BENCH_ENDPOINT=http://127.0.0.1:17317 node bench/compact-v0/run.mjs
```

Runs against whatever watcher is already up (`METALMIND_RECALL_HTTP` or the default loopback endpoint). Results land in `results/` as JSON, one file per run.
