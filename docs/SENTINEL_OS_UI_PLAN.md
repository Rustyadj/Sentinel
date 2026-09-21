# Sentinel OS — control-plane UI plan

Status: proposed, 2026-09-21. Audit of the working tree at `release/continual-memory`
(local HEAD `d23d91c`, 12 commits behind `origin/main` `e52761a`).

## 1. What already exists

**Stack.** Next.js 16 (App Router, RSC), React 19, Tailwind v4 with CSS-variable
tokens in `src/app/globals.css`, Radix primitives + a thin `src/components/ui`
set, Zustand stores, Prisma 6 on Postgres/pgvector, Redis + BullMQ workers
(`learning`, `orchestration`), NextAuth 5, MCP server at `/api/mcp`.

**Surfaces.** ~35 page routes; `/` is the chat surface, `/dashboard` redirects to
`/`. Mission Control survives only as `src/lib/mission-control/*` +
`/api/mission-control`, with a typed data model (`types.ts`) that already carries
a `DataSourceState` (`live | stale | unavailable | demo`) per section — the
provenance discipline the redesign needs is already established.

**Real data available now.**
- Agent runtime: `AgentRuntime`, `AgentSession`, `AgentRuntimeEvent` (12,208 rows),
  plus workspace events, commands, processes, snapshots.
- Collaboration: `CollaborationEvent` (71), `Task` (6), `ApprovalRequest`, `Decision`.
- Knowledge: `KnowledgeObject` (32), `KnowledgeEdge` (25), `Memory` (6),
  `Contradiction`, `ConsolidationRun`, `MemoryRetrieval` (0 rows — model exists,
  write path not producing yet).
- Memory metadata is unusually rich and maps directly onto visual encoding:
  `state`, `confidence`, `importanceScore`, `volatility`, `provenanceClass`,
  `retrievalCount`, `lastRetrievedAt`, `contradictionCount`, `shadowOnly`,
  `supersededById`, and bitemporal `validFrom`/`validTo`/`eventTime`.
- Git execution exists per agent workspace: `src/lib/agent-workspaces/git.ts`
  (`status|clone|pull|fetch|branch|checkout|commit|diff|log`) behind
  `/api/agent-workspaces/[id]/git`.
- Deployment truth exists out-of-band: `/api/version` reports
  `SENTINEL_RELEASE_SHA` + `SENTINEL_BUILT_AT` baked into the container
  (currently `e52761a`, built 2026-09-20T14:58:55Z), `/api/health` checks the DB,
  and `.github/workflows/ci.yml` has `verify → docker → smoke → deploy-gate →
  deploy-production` (SSH to the VPS, gated on the `production` environment).
- `scripts/vps-telemetry.mjs` serves host CPU/mem/disk/network/containers, and
  `mission-control/server.ts` already consumes it — but `SENTINEL_TELEMETRY_URL`
  is unset in `.env`, so that whole section is honestly `unavailable` today.

**Graph today.** `/api/graph` → `buildGraphData` (250 objects / 1000 edges cap) →
`components/graph/KnowledgeGraph.tsx` (1,193 lines, `react-force-graph-3d` via
Three.js), plus `NeuralLens`, `NodeInspector`, `GraphToolbar`, and a second
`components/home/LiveKnowledgeGraph.tsx`. `@xyflow/react` is used for the org chart.

## 2. Gaps that block the spec (this is the real work)

1. **No repository model.** `Project` has no repo URL, branch, remote, or path —
   only `agents[]`/`tags[]`. Nothing links a project to code on disk or on GitHub.
2. **No deployment model.** No `Deployment`, `Release`, `Build`, or `HealthCheck`
   table. Production SHA is only discoverable by calling `/api/version`.
3. **No GitHub API credential.** `GITHUB_CLIENT_ID/SECRET` are login OAuth only;
   there is no token for PRs/checks, and no `gh` CLI on the host. PR/checks/merge
   stages are `NOT CONNECTED` until an installation token or PAT is provided.
4. **No unified event log.** `src/lib/activity/feed.ts` fans in two logs in
   memory; there is no single append-only `SystemEvent` stream, and no SSE for it
   (SSE exists for chat/neural/collab rooms only).
5. **No retrieval telemetry.** `MemoryRetrieval` is empty, so "watch Sentinel
   think" has no live source until the retrieval path writes rows and emits events.
6. **Telemetry not wired** (`SENTINEL_TELEMETRY_URL` unset).
7. **Sandbox note.** Outbound HTTP and `127.0.0.1:3000` are blocked from this
   shell; verification probes must run from inside the app container or the host.

## 3. Canonical state model (the spine)

One derived type, `RevisionPosition`, per project, computed from evidence rather
than declared:

    WORKING → COMMITTED → PUSHED → PR → MERGED → BUILT → DEPLOYED → VERIFIED

| Stage | Evidence | Source |
| --- | --- | --- |
| WORKING | dirty files, untracked count | `git status --porcelain` |
| COMMITTED | local HEAD sha, message, author, time | `git log -1` |
| PUSHED | ahead/behind vs `@{upstream}`, remote HEAD | `git rev-list --left-right --count` |
| PR | number, state, checks | GitHub API — **NOT CONNECTED** |
| MERGED | merge commit on `main`, `main` HEAD | `git ls-remote` / API |
| BUILT | image tag/digest, built-at | `docker inspect`, `/api/version` |
| DEPLOYED | running container image + `SENTINEL_RELEASE_SHA` | `docker inspect` |
| VERIFIED | health endpoint result + timestamp | `/api/health` probe |

Every stage carries `{ status: ok | pending | failed | unknown | not_connected,
evidence[], observedAt, source }`. **Drift** (`deployedSha !== mainSha`) is a
first-class computed field, not a badge — it is what the interface is for.

## 4. Design direction

Three directions were explored and critiqued:

- **A. Spatial mission control** — a fixed instrument panel, projects as rows,
  everything visible at once. Best density; weakest originality; risks becoming
  the card grid the brief rejects.
- **B. Living system map** — one continuous topology; repos, agents, deployments
  and memory all nodes in one space. Highest originality; poor at answering
  "what is broken" in three seconds; expensive.
- **C. Timeline / signal control plane** — time is the primary axis; state is
  where a revision sits on a rail at a given moment. Strong at causality and at
  the temporal-memory requirement; weak as a standing overview.

**Synthesis — "the rail and the field."** A instrument *rail* (from C) carrying
the revision marker per project, laid over a calm typographic substrate (from A)
for density, with the knowledge *field* (from B) as a peer surface that the rail
can focus and that can focus the rail. Two surfaces, one state store, one
selection model: selecting anything anywhere focuses it everywhere.

- Canvas: light neutral (`oklch` near-white, warm grey text), 12px/13px UI type,
  tabular numerals for SHAs and counts, hairline rules instead of card borders.
  Dark mode is a token swap, not the identity. The graph field alone uses deep
  spatial contrast.
- Status color is semantic only: drift/failure amber-red, verified green,
  unknown/not-connected is *greyed and labelled*, never green.
- Motion: only the subsystem currently doing something animates. `prefers-
  reduced-motion` disables all idle motion (already partially honored in
  `globals.css`).

## 5. Renderer decision

Current graph is ~57 nodes; the design must still survive 10⁵. Decision:
**graphology (model) + graphology-layout-forceatlas2 in a Web Worker + Sigma.js
(WebGL) behind a `GraphRenderer` interface**, replacing `react-force-graph-3d`
for the main field. Rationale: off-main-thread layout, incremental
`addNode`/`dropNode` without remounting, custom node/edge programs for the memory
encodings, real semantic zoom and label culling, and it is 2D — depth is used for
meaning, not spectacle. `react-force-graph-3d` stays only if a 3D view is kept;
the interface keeps that swappable. Targets: 60fps pan/zoom at 5k nodes, ≥30fps
at 50k with cluster aggregation, layout never blocking the main thread, and
graceful LOD degradation instead of freezing.

## 6. Vertical slices (commit after each; no deploy, no merge to main)

1. **Schema + adapters.** Add `Repository`, `Deployment`, `HealthCheck`,
   `SystemEvent`; add repo fields to `Project`. Migration only, additive.
2. **Git state aggregator.** `src/lib/control-plane/git.ts` — reuse the existing
   safe-exec pattern from `agent-workspaces/git.ts`, read-only, cached.
3. **Deployment/runtime aggregator.** `docker inspect` + `/api/version` +
   `/api/health` + telemetry when configured; everything else `not_connected`.
4. **`RevisionPosition` resolver + `/api/control-plane` + tests** for drift,
   failure, and unknown paths.
5. **Shell.** New control-plane route and instrumentation strip; no card grid.
6. **Release rail** with evidence-on-click.
7. **Unified event stream** (`SystemEvent` + SSE) with filters and deep links.
8. **Graph field** on the new renderer against real memory/knowledge.
9. **Graph interaction**: pin, isolate, neighborhood, path, inspector.
10. **Cognition view**: write `MemoryRetrieval` rows + emit retrieval events, then
    visualize them.
11. **Temporal mode** off `validFrom`/`validTo`/`eventTime` — real bitemporal
    reconstruction, disabled where data cannot support it.
12. **Motion polish, performance profiling, responsive + a11y pass.**

## 7. Non-negotiables

No invented metrics, no placeholder deployments, no fake agent activity. Missing
integrations render as `NOT CONNECTED` naming the integration. Every operational
claim shows its evidence and its observation time.
