# Roadmap

> What's being worked on, what's next, and what isn't planned. Updated at each release.
>
> **Last updated:** 2026-08-08 · **Current release:** v0.17.0

metalmind is maintained by one person. This page exists so that's a known
quantity rather than a guess: you can see what's coming, what's stalled, and
what has been ruled out.

## Track record

68 releases since 2026-04-20. `CHANGELOG.md` carries the reasoning for each
one, not just the diff. Every performance claim on the site traces to a
harness in `bench/` you can run yourself.

That's the honest version of "will this be around": not a promise, but a
history you can check.

## Now (next 90 days)

**Third-party vault benchmark.** Every recall number published today, 50k
included, is measured on corpora metalmind generated. That's the standing
objection and it cannot be answered from inside. It needs a real vault from
someone who isn't the maintainer, which makes recruitment the blocker rather
than code. It also gates the adversarial bench below.

**Adversarial benchmark.** Queries designed to break recall rather than
flatter it, on the real-vault fixture above. If hit@1 holds at 80%+ there's a
number worth quoting. If it doesn't, better to find out here than in someone
else's review.

**Recall precision follow-ups.** Intent reranking and a branch-aware filter,
both deferred from the v0.9.0 external-repo-leverage scope.

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
