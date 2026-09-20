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
