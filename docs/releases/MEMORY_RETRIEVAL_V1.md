# Release: memory retrieval v1

Query-aware memory retrieval, isolated from the experimental continual-memory
work on `feat/continual-memory`. That branch stays intact and unmerged.

Constructed by auditing `feat/continual-memory` commit-by-commit from `main`
and cherry-picking only what the measured retrieval improvement requires.

## Included

Nine of the twelve branch commits, cherry-picked unmodified (`-x`):

| Commit | Why it is required |
|---|---|
| `162c839` test: isolate the suite from the live application database | The suite shared `DATABASE_URL` with the running app. Required before any of this can be verified without writing to production. |
| `63ef343` test: stop the suite inheriting this deployment's environment | Same isolation, for env vars. |
| `6b71433` fix(queue): namespace BullMQ keys | Production safety. A stray worker from another checkout was consuming this deployment's jobs. Explicitly in scope. |
| `685fe42` feat(memory): deliver retrieved memory to the agents meant to read it | The delivery path (`memory-context`, `context-assembly`) the benchmark measures. Carries the one required migration. |
| `00d5b1d` feat(memory): add a real embedding provider seam | Config/provider seam only, no schema. The benchmark harness imports `readEmbeddingConfig` / `MODEL_DIMENSIONS` from it for run provenance. |
| `2e99025` test(memory): add the benchmark and record the baseline | Benchmark tooling — how the release is verified. |
| `18ede5e` docs(memory): describe what the memory engine actually does | Documentation only. |
| `2b4d3a9` feat(memory): rank retrieved memory against the query | **The improvement.** `retrieval-ranking.ts` + the query passed through `retrieval.ts`. Every benchmark gain comes from this commit. |
| `5225a8a` docs(bench): record the query-aware result and what is still wrong | Documentation only. |

`retrieval-ranking.ts` has no imports and does not touch embeddings or any new
table. It orders and trims a candidate set the caller has already proven the
user may see; scope and governance filtering stay in `buildRetrievalFilters()`
and `memory-governance`, untouched.

## Excluded

| Commit | What it is | Why it is out |
|---|---|---|
| `302d82d` feat(memory): selective persistence gate | `ingestion-gate.ts` (308 lines) | Experimental continual-memory lifecycle. **Orphaned** — nothing but its own test imports it. Contributes nothing to retrieval. |
| `7194ca1` feat(memory): embedding provenance | `MemoryEmbedding` table, migration, `embedding-store.ts` | Would add a table and a migration production does not need. The ranking path never reads it. Verified the benchmark harness only needs `readEmbeddingConfig`/`MODEL_DIMENSIONS`, both present in `00d5b1d`. |
| `ddefd74` fix(prisma): make the migration chain replay from empty | Edits the already-applied `20260705010000_workspace_operating_model` | **Rewrites an applied migration's checksum.** Directly touches the known production schema drift. Not required: the test database is built with `prisma db push`, which bypasses the chain entirely. Excluding it is what keeps `prisma migrate status` clean against production (see below). |

Also excluded transitively: `chain-integrity.test.ts`, `migration-replay.sh`,
`embedding-store.test.ts`, `ingestion-gate.test.ts`, `docs/MEMORY_EMBEDDINGS.md`.

## Database

One migration, `20260920090000_memory_injection_tracking`:

```sql
ALTER TABLE "memory_retrievals"
  ADD COLUMN "injected" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "injectedRank" INTEGER,
  ADD COLUMN "contextTokens" INTEGER,
  ADD COLUMN "consumer" TEXT;
CREATE INDEX "memory_retrievals_injected_idx" ON "memory_retrievals"("injected");
CREATE INDEX "memory_retrievals_consumer_idx" ON "memory_retrievals"("consumer");
```

Additive only: one boolean with a default, three nullable columns, two indexes.
Nothing is dropped, renamed, retyped or rewritten. No data is modified.

It is required, not optional: `recordMemoryRetrieval` writes these columns on
the production path, and `reconsolidation-service` reads `injected` to stop
never-injected retrievals being counted as outcome evidence.

`schema.prisma` vs `main`: the four `MemoryRetrieval` fields above plus their
two `@@index` lines. The `MemoryEmbedding` model from the branch is **not**
present.

Verified against production (`hermesos`) before deployment:

```
47 migrations found in prisma/migrations
Following migration have not yet been applied:
20260920090000_memory_injection_tracking
```

No drift, and **no "migrations have been modified" warning** — which is the
direct payoff of excluding `ddefd74`. `memory_retrievals` in production holds
**0 rows** (40 kB), so the ADD COLUMNs and index builds are effectively
instantaneous and the migration's backfill note is moot.

## Benchmarks

32 cases, `bench/memory/results/release-candidate.json`, compared against the
branch's own `phase7-query-aware.json`:

| Metric | `main` (baseline) | `feat/continual-memory` | This release | vs branch |
|---|---|---|---|---|
| Recall@5 | 0.189 | 0.867 | **0.867** | +0.000 |
| Recall@10 | 0.200 | 0.900 | **0.900** | +0.000 |
| Precision@10 | 0.032 | 0.363 | **0.363** | +0.000 |
| MRR | 0.126 | 0.837 | **0.837** | +0.000 |
| False retrieval | 0.031 | 0.063 | **0.063** | +0.000 |
| Scope leakage | 0.000 | 0.000 | **0.000** | +0.000 |
| Irrelevant retrieval | 0.957 | 0.559 | **0.559** | +0.000 |
| Mean context tokens | 662 | 139.156 | **139.156** | +0.000 |

Every metric reproduces the branch exactly. Nothing excluded contributed to
the measured gains.

### The false-retrieval regression (0.031 -> 0.063)

Not hidden, and not fixed here. Investigated:

It is concentrated in exactly three cases, across two categories:
`corrections` (n=2) and `conflicting_memories` (n=1). All three are the same
memory: `mem-sentinel-model-old` ("Sentinel's default chat model is
claude-3-opus"), surfaced alongside the correction that replaced it.

The baseline's *better* 0.031 is an artifact of failure, not of precision: at
Recall@10 0.200 it was not surfacing topically-relevant memory at all, so it
never reached the superseded belief either. Query-aware ranking now finds both
sides of a contradiction because both are genuinely about the subject asked
about.

Levers checked and rejected:

- **Relative floor / top-K.** Measured directly: the superseded memory scores
  7.022 against the correction's 8.439 — **0.832 of the best score**. Excluding
  it needs a floor above 0.83 (currently 0.45). That would also discard the
  second memory in `contradictions` and both senses in `ambiguous_memories`,
  which the dataset requires to surface. Trading Recall@10 and MRR for one
  metric, which is exactly what was ruled out.
- **Tuning thresholds / weights to the dataset.** Refused. `bench/memory/README.md`
  names this as the one thing that makes the exercise worthless.
- **A "Correction:"-prefix or `correction`-tag heuristic.** Refused. It would
  pass this benchmark while doing nothing in production, where memories are not
  reliably tagged that way — a benchmark result bought without a real
  improvement.

What actually works already: bitemporal supersession. `mem-sentinel-port-old`
carries `supersededById` and `validTo`, and `excludeFromRetrieval()` in
`memory-governance` filters on `validTo: null` — the `supersession` category
scores recall 1.000 with false retrieval **0.000**. `mem-sentinel-model-old`
simply was never marked. This is a data-completeness gap, not a ranking defect,
and the existing production mechanism handles it correctly when the data is
recorded.

**Tradeoff accepted:** Recall@10 0.200 -> 0.900 and MRR 0.126 -> 0.837, against
false retrieval 0.031 -> 0.063 confined to unmarked contradictions. Retrieval
context also fell 662 -> 139 tokens, so the prompt carries less wrong material
in absolute terms than it did before. Contradiction resolution at retrieval
time is follow-up work.

## Tests

**653 passed, 0 failed, 0 skipped (107 files).** Typecheck clean. Lint 0 errors
(39 pre-existing warnings, unchanged from `main`). Production build succeeds.

Reconciliation against the branch's 686: the 33-test difference is exactly the
excluded files — `ingestion-gate.test.ts` (19), `embedding-store.test.ts` (10),
`chain-integrity.test.ts` (4). 653 + 33 = 686. No production test was lost.

One pre-existing flake was found and diagnosed, not papered over:
`tests/learning/memory-governance.test.ts` decay sweep failed on first run.
Cause: `runMemoryDecaySweep` uses `take: 500` with **no `orderBy`**, so once the
shared test database accumulates more than 500 candidate memories (it held 680
from prior runs) the row under test is not reliably swept. Unrelated to
retrieval — this release touches nothing in `memory-governance`. Confirmed by
clearing the accumulated fixture rows in the throwaway vitest database, after
which it passes. The missing `orderBy` is a genuine latent defect in the sweep
and is listed as follow-up rather than fixed here, being out of scope.

## Workspace isolation

**Workspace isolation is not implemented by this release, and this release does
not claim it.** The branch's workspace/schema work is excluded in full.

What is true: existing scope enforcement is preserved and unweakened. Scope
leakage measures **0.000** across project, workspace, user and cross-project
categories, identical to both `main` and the branch. Ranking never widens
visibility — it only orders and trims a candidate set that
`buildRetrievalFilters()` has already scoped.

Note that `project_isolation` scores recall 0.000. That is a recall miss (a
memory that should have surfaced did not), **not** a leak; leakage stays 0.000
in every isolation category.

## Risks

- **Ranking changes what agents see.** The largest behavioural change. Prompts
  now carry query-relevant memory instead of the same value-ordered top-N per
  scope. Mitigated: `buildMemoryContext` is fully self-guarded — any failure
  returns empty context and the task proceeds as if memory did not exist.
- **Unmarked contradictions can surface both sides.** Quantified above at 3 of
  32 cases. An agent may see a superseded belief next to its correction.
- **`injected` defaults to false for existing rows.** Production has none, so
  no effect; the usefulness signal simply starts accumulating from deployment.
- **Two non-concurrent index builds.** On a 0-row, 40 kB table. Negligible.
- **BullMQ key prefix change.** Workers and enqueuers must deploy together or
  jobs enqueued under one prefix are not consumed under the other. They ship in
  the same compose deployment.

## Rollback

The release is one additive migration plus application code, so code rollback
alone is sufficient — the added columns are inert to the previous code.

```bash
cd /opt/sentinel-os
git checkout main && git reset --hard <pre-merge-main-sha>
docker compose up --build -d
docker compose ps && docker compose logs app --tail 50
```

Leave the four columns in place. Nothing reads them once the code is rolled
back, `injected` has a default, and the other three are nullable, so the
previous code inserts into the table unchanged. Dropping them is not required
and would be the riskier action.

If the columns must also be reverted (not recommended, and only with the
application stopped):

```sql
DROP INDEX IF EXISTS "memory_retrievals_consumer_idx";
DROP INDEX IF EXISTS "memory_retrievals_injected_idx";
ALTER TABLE "memory_retrievals"
  DROP COLUMN "consumer", DROP COLUMN "contextTokens",
  DROP COLUMN "injectedRank", DROP COLUMN "injected";
DELETE FROM "_prisma_migrations" WHERE migration_name = '20260920090000_memory_injection_tracking';
```

Database backup taken and verified immediately before deployment; path and
checksum recorded in the deployment run.

## Follow-up work (deliberately not in this release)

1. Contradiction resolution at retrieval time — the false-retrieval residue.
2. Workspace isolation — schema and architecture, excluded in full.
3. Reconsolidation, consolidation/generalization, lifecycle memory — remain on
   `feat/continual-memory`.
4. Embedding provenance (`MemoryEmbedding`) — ready on the branch, deferred
   because retrieval does not need it.
5. The selective persistence gate — currently orphaned code on the branch.
6. `runMemoryDecaySweep` has no `orderBy` under `take: 500`; decay coverage is
   non-deterministic once candidates exceed the limit.
7. The migration chain still cannot replay from an empty database
   (`ddefd74` on the branch fixes this, but rewrites an applied migration —
   needs its own change window, separate from a retrieval release).
