# Control plane — validation against a production clone

Date: 2026-09-21. Branch: `feat/control-plane-ui`.
**Production was not modified.** The only operation performed against the live
database was `pg_dump` (read-only). Nothing was deployed, merged or pushed.

## Method

1. `pg_dump` of `hermesos` from `sentinel-os-postgres-1` (23 MB, 102 tables).
2. Restored into `prod_clone` and `prod_clone2` on `sentinel-dev-postgres`
   (port 55432), which is a scratch server, not production.
3. `prod_clone`: applied the two control-plane migrations only, registered six
   real repositories, ran the observation/resolver path and the API route.
4. `prod_clone2`: ran `prisma migrate deploy` exactly as production would.

Caveat on fidelity: the clone runs **pgvector 0.8.5**; production runs **0.8.2**.
The dump restored with zero errors and none of these migrations touch a vector
column, so this does not affect the result — but the clone is not bit-identical
to production in that one respect.

## Findings

### 1. `migrate deploy` would apply nine migrations, not two

Production is **seven migrations behind the branch** before the control plane is
even considered:

```
20260920120000_memory_embedding_provenance
20260920140000_memory_reconsolidation
20260920160000_memory_workspace_scope
20260920180000_memory_event_time
20260920200000_memory_ingestion_decisions
20260920220000_memory_supporting_executions
20260920230000_memory_verification_policy
20260921120000_control_plane                 ← control plane
20260921130000_repository_deploy_targets     ← control plane
```

All nine applied cleanly to `prod_clone2` and `migrate status` then reported
"Database schema is up to date".

### 2. The lineage is behind, not forked

Production's `_prisma_migrations` holds 52 rows against 59 in the repository.
Two of those rows are the *same* migration, `20260705010000_workspace_operating_model`,
both **rolled back** (`finished_at` null, `rolled_back_at` set, 0 steps applied),
and that migration is no longer in the repository. Prisma correctly ignores
rolled-back rows, so effective applied = 50, pending = 9, and there is **no
migration applied to production that the repository does not have**. The
divergence recorded in earlier notes is staleness plus two dead rows, not a fork.

### 3. Existing data survives unchanged

Row counts for all 98 pre-existing tables are **identical** before and after the
full nine-migration deploy. Seven tables are added (four control-plane, three
memory). `md5` of `memories` (`id||content||state||confidence`) is byte-identical:
`85f4555115d55efdcf12c036957a8b1c`.

One migration contains a data write — `20260920160000_memory_workspace_scope`
backfills `memories.workspaceId` from the owning project. On this data it
**modified zero rows**: all four project-scoped memories belong to projects with
no workspace. Those memories are `scope = "project"`, and workspace filtering
only gates `scope = "workspace"` rows, so the null is inert here.

### 4. The control-plane schema change is purely additive

A schema-only `pg_dump` diff of production against the migrated clone contains no
removal or modification of any existing object — only four `CREATE TABLE`s, nine
indexes and their foreign keys. (The sole `<` lines in the diff are pg_dump's own
per-dump `\restrict` nonce.)

### 5. Two defects found by running against real repositories

Both were found only because the clone was fed real checkouts, and both are fixed.

**The marker advanced past a stage that could not be established.** MobileOps is
merged into main and its container is healthy, but the container declares no
revision. The marker skipped the unknown `built`/`deployed` stages and landed on
`verified` — the rail asserting that commit was live on the strength of a
healthcheck belonging to a container whose contents nobody could identify. Now
only `not_connected` is skipped (Sentinel was never able to ask); `unknown` stops
the marker. MobileOps now reads `merged`.

**A container with no revision was described as running something else.** The
`deployed` detail rendered as "production is running unknown, not this commit".
It now reads "A container is running in production, but it declares no revision,
so what it is running is unknown."

### 6. Observation against the clone is accurate

Five rails, one problem, in 463 ms:

| Repository | Marker | Deployed | Agreement | Drift |
| --- | --- | --- | --- | --- |
| Sentinel OS | committed | diverged | **corroborated** | match |
| MobileOps | merged | unknown | none | unknown |
| Plumbline | committed | unknown | none | unknown |
| Sentinel (merge checkout) | committed | not reached | — | unknown |
| Deploy config | committed | not reached | — | unknown |
| Offsite repo | — | — | — | listed as unobservable (host `vps-2`) |

Sentinel OS reads **corroborated**: the container's baked `SENTINEL_RELEASE_SHA`
and the running application's own `/api/version` independently agree on
`e52761a`. Its health probe returned `ok (200)` from `/api/health`. Every other
row's `unknown` is the truth — those images carry no revision label.

`GET /api/control-plane` returned 200 with `no-store`, five positions and one
problem, survives JSON round-tripping, and returns an error status when
`requireUser` rejects.

### 7. Build

`npm run build` succeeds against the migrated clone. `/control` and
`/api/control-plane` both compile as dynamic routes. Six Turbopack warnings are
pre-existing (`agent-workspaces/providers/docker.ts`, `snapshots.ts`,
`configEditor.ts`); none come from control-plane code.

## Discrepancy summary

| # | Finding | Status |
| --- | --- | --- |
| 1 | Production is 7 unrelated migrations behind; `migrate deploy` applies 9 | **Needs a decision** — see plan |
| 2 | Two rolled-back rows for a deleted migration | Benign; Prisma ignores them |
| 3 | Clone runs pgvector 0.8.5 vs production 0.8.2 | Environmental; no vector columns touched |
| 4 | Marker advanced past `unknown` stages | Fixed + regression test |
| 5 | "running unknown, not this commit" copy | Fixed + regression test |
| 6 | Most containers on this host carry no revision label | Not a defect — reported as `unknown`; fixable by setting `org.opencontainers.image.revision` at build time |

## Production deployment plan

Not executed. Requires explicit approval.

**Before anything**
1. `pg_dump` production to a dated file and verify it restores into a scratch
   database. The clone used here proves that path works.
2. Decide on finding 1. The control plane cannot be deployed alone through
   `migrate deploy`: Prisma applies pending migrations in order, so the seven
   memory migrations go with it. Either ship all nine deliberately, or hold the
   control plane until the memory work is separately approved.

**Deploy**
3. Merge `feat/control-plane-ui` (9 commits) into `main` — requires review; the
   branch has never been pushed.
4. The existing workflow (`ci.yml`: verify → docker → smoke → deploy-gate →
   deploy-production) runs migrations and deploys the green commit over SSH. Let
   it run; do not apply migrations by hand.
5. Watch `deploy-production`; it is gated on the `production` environment and has
   previously stalled awaiting approval.

**After**
6. `curl https://sentinel.srv1427612.hstgr.cloud/api/version` and confirm the
   commit equals `git rev-parse origin/main`.
7. Register repositories. Nothing appears at `/control` until rows exist in
   `repositories`; the page deliberately does not scan the filesystem. Insert the
   real checkouts with their `deployTargets`.
8. Confirm `/control` shows Sentinel OS as `corroborated` and matching main.

**Recommended follow-up, not required**
9. Add `org.opencontainers.image.revision` to the Docker build. It is the only
   revision source a deploy cannot leave stale, and it would turn most of the
   `unknown` rows above into real answers.

## Cleanup

The scratch artifacts still exist for inspection:

```
docker exec sentinel-dev-postgres psql -U postgres \
  -c 'DROP DATABASE prod_clone' \
  -c 'DROP DATABASE prod_clone2' \
  -c 'DROP ROLE cp_validator'
```
