# Spec: Adversarial recall benchmark

Queries designed to break recall rather than flatter it. The roadmap has listed
this since v0.17.0 and nothing has been built.

## Assumptions

Correct these before I build against them.

1. The corpus is the maintainer vault, not a synthetic fixture. Adversarial
   queries only mean something against notes with real ambiguity in them.
2. Gold labels are hand-authored. There is no third-party adversarial dataset
   for personal knowledge vaults, so labelling is the cost of the bench.
3. This measures the default path: hybrid, no rerank. The rerank column is
   reported beside it, as the other harnesses do.
4. Publishing gate applies. No number ships to the site without stating how the
   queries were chosen, since an adversarial set is trivially gameable by
   whoever writes it.

## Objective

Answer one question: **where does recall fail on a vault it was built for, when
the query is not a friendly paraphrase?**

Existing harnesses do not answer it. `recall-v0` uses paraphrases of note
content. `recall-at-scale` measures whether scale degrades a corpus of HN
comments. `longmemeval` is third-party and its questions are conversational
rather than hostile. All three are cooperative by construction.

Success is a number worth quoting *or* a list of defects worth fixing. A bench
that reports 95% and finds nothing has failed at its job.

## The five adversarial classes

Each class is a hypothesis about how recall breaks. This is the spec's real
content; everything else is harness.

**1. Vocabulary mismatch.** The query uses none of the note's words.
Note says "we chose Postgres over CockroachDB for operational familiarity";
query asks "why did we not go with the distributed database". Tests whether
the semantic leg earns its place, since BM25 cannot answer this at all.

**2. Competing near-duplicates.** Two notes cover the same topic, one
superseded or archived. The query is ambiguous between them and the correct
answer is the current one. Tests folder penalties and supersede downweighting
together, which nothing currently measures on real notes.

**3. Distinguishing detail.** Two notes differ in one particular; the query
turns on it. "What did we decide about retries in the *gateway*" against a
vault holding retry decisions for three services. Tests whether chunk identity
and the per-file cap surface the right chunk rather than the right note.

**4. Temporal.** "What did we decide most recently about X" where the vault
holds several decisions across time. Tests recency handling, which today is
nothing beyond the supersede penalty. I expect this class to score worst.

**5. Negation and absence.** "What did we rule out", "what is not supported".
Embeddings famously collapse negation, and this is where I expect a real
defect rather than a tuning gap.

## Functional requirements

WHEN the harness runs THE SYSTEM SHALL report hit@1, hit@3, hit@5, MRR and
NDCG@5 per adversarial class and in aggregate.

WHEN a class scores below 50% hit@5 THE SYSTEM SHALL list every miss with its
query, expected note and actual top-5, because at that rate the individual
failures are the finding rather than the average.

WHERE the rerank extra is installed THE SYSTEM SHALL report a rerank column
beside the default path.

IF fewer than 10 queries exist in a class THEN THE SYSTEM SHALL refuse to
report a rate for it, since one question would move it by 10 points or more.

THE SYSTEM SHALL record the vault commit the run was measured against, because
the corpus is a live vault and a number without that is unreproducible.

THE SYSTEM SHALL keep queries and gold labels in a file separate from the
runner, so adding a query never means editing harness code.

## Non-goals

- Not a regression gate. Too small and too hand-authored to block a release on.
- No new retrieval features. This measures; fixing is separate work.
- Not published to the site until the selection method is written down.

## Structure

```
bench/adversarial-v0/
  README.md        method, selection rules, and what each class tests
  queries.json     query, class, expected note stem, why it is adversarial
  run.mjs          harness, mirroring bench/recall-v0/run.mjs conventions
  results/         gitignored except .gitkeep, as the other benches do
```

## Success criteria

- 50+ labelled queries, 10 minimum per class.
- Every query carries a one-line justification for why it is adversarial.
  Unjustified queries are how an adversarial bench becomes a flattering one.
- The run reports per-class and aggregate numbers and names every miss in a
  failing class.
- At least one finding worth acting on, or an explicit statement that recall
  held across all five classes.

## Open questions

1. **Does the vault have enough near-duplicate pairs for class 2?** It holds 18
   superseded notes across 8 targets, which is enough only if those topics
   admit ambiguous queries. Needs checking before labelling starts.
2. **Should class 4 queries be answerable at all today?** If recency handling
   does not exist, the class measures a known gap rather than discovering one.
   Worth keeping as a documented zero rather than dropping.
3. **Who labels?** Self-labelling by the person who wrote both the notes and
   the retrieval code is the weakest part of this design, and I do not have a
   way around it.
