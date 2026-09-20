# Sentinel memory benchmark

A repeatable measurement of whether Sentinel retrieves the *right* memory —
run before and after every memory phase, so a change has to prove itself
rather than merely add code.

## Running

```bash
DATABASE_URL="$SENTINEL_TEST_DATABASE_URL" npx tsx bench/memory/run.ts --label baseline
npm run bench:memory -- --label after-selective-persistence --compare baseline
```

The runner refuses to start unless `DATABASE_URL` names a database matching
`/vitest|test|bench/`. It seeds fixture users, projects and memories and
deletes them again on the way out (`--keep-fixtures` leaves them for
inspection). It must never be pointed at production.

Results are written to `bench/memory/results/<label>.json`. That file is the
artefact: `--compare <label>` diffs the current run against a stored one and
marks each metric `++` (better) or `!!` (worse).

## What it measures

25 capability categories — factual, cross-session, project, workspace,
preference and episodic recall; temporal ordering; entity relationships;
semantic and lexical retrieval; corrections, contradictions, supersession and
staleness; irrelevant- and false-memory rejection; project, workspace and user
isolation plus cross-project leakage; procedural memory; long-running
accumulation; duplicate, ambiguous and conflicting memories.

Metrics: Recall@K, Precision@K, MRR, false-retrieval rate, scope-leakage rate,
irrelevant-retrieval rate, temporal accuracy, mean injected context tokens, and
retrieval / embedding / rerank latency.

Two deliberate choices:

- **Precision@K divides by results returned, not K.** A case with two relevant
  memories that returns exactly those two scores 1.0 rather than 0.2.
- **Rejection-only cases have no recall.** They return `NaN` and are excluded
  from the recall average instead of scoring 1.0, which would flatter it.

## Not tuning against the test set

The dataset is fixed and lives in `dataset.ts`. Changing a case so a new
implementation passes is the one thing that makes this whole exercise
worthless. If a case is genuinely wrong, fix it, re-run the **baseline**
retriever, and store a new baseline — never compare a new implementation
against a baseline measured on a different dataset.

## Adding a retriever

Later phases register an implementation of the `Retriever` interface in
`harness.ts` and add it to `RETRIEVERS` in `run.ts`. The cases and metrics are
untouched, so `--retriever multilane --compare baseline` is like-for-like.

## Baseline result (commit 18ede5e)

Recorded in `results/baseline.json`. Summary: Recall@10 **0.200**, Precision@10
**0.032**, MRR **0.126**, irrelevant-retrieval **0.957**, temporal accuracy
**0.000**, scope leakage **0.000**.

The cause is structural, not a tuning problem. `RetrievalContext` has no query
field: `retrieveContext` returns the top-N in-scope memories ordered by
`(pinned, valueScore, importanceScore, createdAt)` and never sees what was
asked. Across 32 cases the benchmark observed only **4 distinct result sets** —
one per distinct scope context. The multi-factor `retrieval-planner.ts`, which
does compute a relevance signal, is not on this path.

Scope isolation is the one genuinely strong result: zero leakage across
project, workspace and user boundaries, and quarantined memories never
reached a prompt.

## Result after query-aware retrieval (commit 2b4d3a9)

`results/phase7-query-aware.json`, same 32 cases:

| Metric | Baseline | Query-aware |
|---|---|---|
| Recall@5 | 0.189 | **0.867** |
| Recall@10 | 0.200 | **0.900** |
| Precision@10 | 0.032 | **0.363** |
| MRR | 0.126 | **0.837** |
| Irrelevant retrieval | 0.957 | **0.559** |
| Mean context tokens | 662 | **139** |
| Scope leakage | 0.000 | 0.000 |
| False retrieval | 0.031 | **0.063** |

False retrieval got *worse*, and that is not hidden. Two cases now surface a
superseded belief alongside the correction that replaced it: ranking finds both
because both are about the same subject, and nothing yet resolves
contradictions at retrieval time. Supersession recorded bitemporally
(`validTo`) is already excluded; a contradiction that was never marked as one
is not. That is Phase 8's job.

Still at zero and worth watching: `temporal_ordering` (retrieval does not order
episodic memories by event time), `ambiguous_memories`, and
`project_isolation` recall — the last is a recall miss, not a leak; leakage
remains 0.000 across every isolation category.

## Result after Phase 8 — contradiction / reconsolidation (commit pending)

`results/phase8-contradiction.json`, same 32 cases:

| Metric | Baseline | Query-aware | Phase 8 |
|---|---|---|---|
| Recall@5 | 0.189 | 0.867 | **0.900** |
| Recall@10 | 0.200 | 0.900 | **0.933** |
| Precision@10 | 0.032 | 0.363 | **0.381** |
| MRR | 0.126 | 0.837 | **0.870** |
| False retrieval | 0.031 | 0.063 | **0.000** |
| Irrelevant retrieval | 0.957 | 0.559 | 0.589 |
| Mean context tokens | 662 | 139.2 | 142.5 |
| Scope leakage | 0.000 | 0.000 | 0.000 |
| Temporal accuracy | 0.000 | 0.000 | 0.000 |

The Phase 8 target was false retrieval below 0.063 without losing Recall@10
0.900 or MRR 0.837. False retrieval is 0.000 and both protected metrics went
up rather than holding.

### Attribution

Two changes landed together, so they were measured apart.
`results/phase8-ablation-no-consolidation.json` is the same run with
`SENTINEL_BENCH_NO_CONSOLIDATE=1`, which seeds the corpus without running the
reconsolidation pass:

| | tokenizer fix only | + contradiction handling |
|---|---|---|
| Recall@10 | 0.933 | 0.933 |
| MRR | 0.870 | 0.870 |
| Precision@10 | 0.366 | **0.381** |
| False retrieval | 0.063 | **0.000** |
| Mean context tokens | 146.3 | **142.5** |

So the recall and MRR gain is entirely the tokenizer fix — `tokenize` kept the
full stop that ends a sentence inside the token, so "stores embeddings." could
never match a query's "embeddings". That also fixed `ambiguous_memories`
(0.000 → 1.000). The false-retrieval elimination is entirely contradiction
handling, and it *reduces* context tokens, because the stale belief it removes
was occupying budget.

Neither number comes from a benchmark-specific filter: the corpus is seeded as
raw observations and `reconsolidateScope` — the production entry point — makes
the supersession link the same way it would when a correction is ingested.

### What is still at zero

- `temporal_ordering` accuracy (0.000). Retrieval still does not order
  episodic memories by event time. Recall for the category is 1.000; it is the
  *ordering* that is unimplemented.
- `project_isolation` recall (0.000) — a recall miss, not a leak. Leakage is
  0.000 across every isolation category.
- `stale_information` recall (0.000).
- Irrelevant retrieval rose 0.559 → 0.589. The tokenizer fix matches more
  tokens, so more low-scoring memories clear the coverage floor. It is a real
  cost and is not being written off.
