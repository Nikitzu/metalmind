# judge-relevance bench

Compares recall orders on a real vault for the same queries: plain hybrid, the cross-encoder `--rerank` (no-op since 0.25.0), and the Jev judge in both request shapes, batched (all hits in one request) and each (one request per hit, `METALMIND_JUDGE_MODE=each`). Reports top-1 hits and MRR on answerable queries, and how many hits the judge keeps on unanswerable ones (fewer is better; plain always shows 5).

Run with the judge enabled and the watcher up:

    node bench/judge-relevance/run.mjs --cli ~/Documents/metalmind/cli/dist/cli.js

The cross-encoder column needs `metalmind-vault-rag[rerank]` installed (first `--rerank` call does it).

Numbers stay in the maintainer vault (TypeSafe MCA 2.3(f)). The cross-encoder is removed only when `judged` is at or above `cross` on both top-1 and MRR here.
