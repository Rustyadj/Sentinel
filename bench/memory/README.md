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

### Diagnosis: the `project_isolation` and `stale_information` recall misses

Investigated after Phase 8. Neither is a ranking, filter, scope-resolution or
retrieval-budget fault, and neither is a leak.

`isolation-project` asks "What is the deployment domain for this project?" and
expects `mem-sentinel-port`. The Sentinel project corpus contains no memory
stating a deployment domain; the only domain in the world is MobileOps's, and
that is precisely what the case forbids. Returning nothing is the *correct*
behaviour for this corpus, and the case scores it as a miss. The fixture is
asking for an answer the corpus does not contain.

`stale-port` asks "Give me the current deployment configuration" and expects
the same memory. Measured token overlap between query and memory:

    "What is the deployment domain for this project?"  -> []
    "Give me the current deployment configuration."    -> []

Zero, both times, against `[sentinel, application, container, listen, port,
3000, behind, traefik, deploy, port]`. Ranking drops a memory that matches no
query term, by design — that rule is what took irrelevant retrieval from 0.957
to 0.559. "deployment configuration" and "listens on port 3000 behind Traefik"
are the same subject to a reader and share no token.

This is the lexical-only ceiling, and it is the strongest evidence in the
benchmark for semantic retrieval: both cases are exactly what an embedding
would catch. They are left failing rather than fixed. Adding "domain" or
"configuration" to the port memory's tags, or a synonym list built from these
two queries, would raise the score without improving retrieval for anything
else — which is the one thing this benchmark must never be used for.

Isolation itself is unaffected: scope leakage is 0.000 in every category,
including these.

## Result after workspace isolation (phase9-workspace-isolation.json)

Every metric identical to Phase 8 — Recall@10 0.933, MRR 0.870, false
retrieval 0.000, scope leakage 0.000, 142.5 context tokens. That is the
intended result: Memory gained a real `workspaceId` and workspace-scoped
retrieval stopped being an owner-isolation approximation, at no measurable
retrieval cost.

The benchmark cannot show the part that actually changed, because it has one
user per workspace and therefore no colleague to share with. That guarantee is
covered by `tests/memory/workspace-isolation.test.ts`, which adds a second
authorised member of workspace A and asserts they see workspace memory they do
not own — something the previous implementation could not do — while still
seeing nothing of workspace B's.

The only fixture change was adding `workspaceId: WS_PRIMARY` to the two
workspace-scoped memories, because a workspace-scoped row without one is now
unresolved by definition. No case, query, relevant set or forbidden set moved.

## Result after temporal / episodic ordering (phase10-temporal-ordering.json)

| Metric | Phase 9 | Phase 10 |
|---|---|---|
| Temporal accuracy | 0.000 | **1.000** |
| Recall@10 | 0.933 | 0.933 |
| Precision@10 | 0.381 | 0.381 |
| MRR | 0.870 | 0.870 |
| False retrieval | 0.000 | 0.000 |
| Scope leakage | 0.000 | 0.000 |
| Irrelevant retrieval | 0.589 | 0.589 |
| Mean context tokens | 142.5 | 142.5 |

Ordering was at zero because there was nothing correct to order by. Memory
carried `createdAt` (insertion), `validFrom` (when a belief became valid) and
`updatedAt`, and none of them is event time — an incident that happened in
March and was written down in September is not "valid from September", and
anything recalled after the fact inserts in the order it was remembered.
Migration 20260920180000 adds a nullable `eventTime`, and ordering falls back
to `validFrom` rather than inventing one when it is absent.

The first implementation resequenced the whole result set by time. That
scored temporal accuracy 1.000 and cost MRR (0.870 → 0.848): the oldest memory
in the set was a standing configuration fact, so "walk me through the rollout"
answered with that first and the rollout second. Only memories that can *be* a
sequence — episodic, or carrying an event time — are now resequenced, and
everything else keeps its ranked position behind them. That recovers MRR in
full.

The benchmark's episodic fixtures were recorded in the order they occurred, so
that case cannot distinguish event time from insertion order, and the fixtures
were deliberately not changed to make it do so. That distinction is proved in
`tests/memory/temporal-ordering.test.ts`, where the three events are inserted
in exactly the reverse of the order they happened: ordering by `createdAt`
returns them backwards, and the test asserts both the correct sequence and
that the rows really are inserted the other way round.
