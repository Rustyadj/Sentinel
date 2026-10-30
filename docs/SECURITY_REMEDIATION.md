# Security remediation and ship plan

Status as of 2026-10-19. Production was verified to run `main` at
`7b6e2e5` (`GET https://sentinel.srv1427612.hstgr.cloud/api/version`), so every
finding below that is on `main` is live in production until this branch deploys.

Every finding was checked against the code. Items marked _host check_ could not
be verified from the repository and need someone on the VPS.

## 1. Findings

### Critical

| ID | Finding | Evidence | Status |
|---|---|---|---|
| C1 | **The internet-facing app holds the host Docker daemon.** `app` mounts `/var/run/docker.sock`, joins the socket's group (`group_add: DOCKER_GID`) and ships the docker CLI. Any code execution in the Next.js process (about 280 routes plus their dependencies) means root on the host. `/api/chat` runs agent runtimes in-process (`routeRuntimeChat`), so a prompt-injected CLI agent that can run shell commands is in the same container as the socket. Codex runs with `--sandbox workspace-write` (whether that blocks the unix socket is _host check_). Gemini is configured `--approval-mode yolo` but is not mounted today. | `docker-compose.yml` app volumes and `group_add`; `Dockerfile` copies `/usr/local/bin/docker`; `src/lib/agents/runtime/config.ts` | **Open**: needs operational approval. Design in §3, plan in §4-D |
| C2 | **Anyone on the internet could create an account and join the operator's workspaces.** `/api/auth/register` and a first Google or GitHub sign-in created users with no restriction. `listWorkspaces()` then made every user a Member of the shared default workspaces, giving read access to projects, tasks, documents, approvals, meetings and agent computers, plus the ability to create tasks and approval requests. | `src/app/api/auth/register/route.ts`, `src/auth.ts` jwt callback, `src/lib/workspaces/objects.ts` `ensureDefaultWorkspaces` | **Fixed** |

### High

| ID | Finding | Evidence | Status |
|---|---|---|---|
| H1 | **Any user could change instance-wide settings.** Without an agent ID, `getControlPlaneUser()` returns the caller's highest role in *any* workspace. Any user can `POST /api/workspaces` and become owner of the new workspace, which made them "owner" of the global `custom_modules` and `installed_modules` tables. That was enough to publish an iframe module that every user sees. | `src/lib/agents/permissions.ts`, `src/app/api/workspaces/route.ts` | **Fixed** |
| H2 | **Workspace `image` and `homePath` were passed from the request body to `docker run` on the host.** Callers could pull and run any image, and an image value starting with `-` is parsed by docker as a flag. | `src/app/api/agent-workspaces/route.ts` → `providers/docker.ts` | **Fixed** |
| H3 | **Host CLI OAuth credentials are mounted read-write into the internet-facing app.** `./runtime-agents/home` (`.claude/.credentials.json`, `.codex/auth.json`) is mounted into both `app` and `orchestration-worker`. | `docker-compose.yml` | **Open**, §3 step 4 |
| H4 | **Hermes hub runs as root with host networking.** It sets `HERMES_UID/GID 0` and `HERMES_ALLOW_ROOT_GATEWAY`, uses `network_mode: host`, and mounts another profile's data. The compose label advertises the public IP on port 4860, and the agent docs say Nathan2 binds `0.0.0.0:4864`. Ports 4860–4864 and 8977 did not answer from this sandbox, but the sandbox may block those ports, so public exposure is unconfirmed (_host check_). | `docker-compose.hermes.yml` | **Open**, §4-C |
| H5 | **Login and registration had no rate limiting.** | `src/auth.ts`, `src/app/api/auth/*` | **Fixed** |

### Medium

| ID | Finding | Status |
|---|---|---|
| M1 | Mass assignment: `PUT /api/modules/custom/[id]` passed the raw body to Prisma, so `moduleId`, `href` and `config` could be overwritten. `POST` did no validation, and iframe content accepted any URL, including `javascript:`. | **Fixed** |
| M2 | Mobile bearer tokens lasted 30 days with no revocation, and a token without `exp` was accepted. | **Fixed**: default lifetime 7 days, `exp`/`iat` required, `POST /api/auth/mobile/revoke` |
| M3 | Hardcoded Postgres credentials `hermes:hermes` and an unauthenticated Redis. Neither port is published to the host, but both are reachable from every container on `sentinel_net`, including `app`. | **Repo fixed** (both configurable). **Rotation open**, §4-B |
| M4 | `schema.prisma` has drifted from the migration chain (`mcp_*` tables, `agents.updatedAt`, `documents.agentId/history`, `custom_modules` defaults, and more). Running `prisma migrate dev` would generate DROP statements. This was already on `main`; this branch adds no drift (verified by replaying the full chain on a fresh database). | **Open** |
| M5 | A client component (`WorkspaceHeader`) imported the `@/lib/workspaces` barrel, which pulls `auth`, Prisma and Redis into the browser bundle. | **Fixed** (only instance). A lint rule is a follow-up |
| M6 | The Redis healthcheck passed on `NOAUTH`, because `redis-cli` exits 0 on an error reply. | **Fixed** |

### Low

| ID | Finding | Status |
|---|---|---|
| L1 | `.env.development` was tracked. It holds the URL of a localhost scratch database with a placeholder password, not a production secret. | **Fixed** (untracked; `.example` added) |
| L2 | `src/modules/index.ts` imported a non-existent `./knowledge`. The import sat in unreachable code, so it never broke the build. | **Fixed** (removed) |
| L3 | Documentation drift: README listed ICF, CRM and Finance modules that don't exist; MODULE_SYSTEM and ARCHITECTURE described a registry nothing reads; COMPONENTS listed primitives that aren't used. | **Fixed** |
| L4 | Agent instructions were split across GEMINI.md, AGENTS.md and CLAUDE.md. | **Fixed**: AGENTS.md is the only source |
| L5 | Rate-limit keys trust the first `X-Forwarded-For` hop, the same as the MCP limiter. That's correct only while Traefik replaces untrusted forwarded headers (its default). | _host check_: confirm no `forwardedHeaders.insecure` |

### Corrections to the earlier audit

- Unused components: about **7,100 lines across 52 files**, not about 2,000.
- Unused dependencies: **nine**, not five.
- "Eight modules bypass the registry": the registry itself was write-only. Its only reader was the retired SettingsPage.
- `.env.development` credentials: a localhost placeholder (Low), not a production credential.

## 2. Changes on this branch

| Commit | Change |
|---|---|
| `fix(modules): allowlist custom-module fields` | zod allowlist on create and update; iframe content must be https |
| `fix(auth): invitation-only signup, rate limiting, mobile token revocation` | `SENTINEL_SIGNUP_ALLOWLIST` / `SENTINEL_OPEN_SIGNUP`; per-account and per-address limits; additive migration `users.mobileTokensRevokedAt` |
| `fix(agent-workspaces): allowlist images, validate homePath` | `AGENT_WORKSPACE_ALLOWED_IMAGES`; the argv is also checked at the Docker boundary |
| `fix(auth): count only failed sign-ins` | Legitimate repeat sign-ins (and the RC suite) never lock an account |
| `chore(deploy): configurable Postgres/Redis credentials` | Defaults unchanged; the rendered compose config is identical when the new variables are unset |
| `refactor: remove unreachable UI, write-only registry, unused deps` | 52 files and 9 packages |
| `docs: consolidate agent instructions; archive reviews` | `docs/archive/` |
| `fix(modules): gate instance-wide settings on the default workspace` | Closes H1 |

## 3. Isolated workspace execution (C1, H3)

The goal is to take the Docker socket and the host credentials away from the
internet-facing process **without building a new system**. This plan moves
existing components across a process boundary. The hardened workspace
containers stay exactly as they are: non-root uid 10001, `--cap-drop ALL`,
`no-new-privileges`, pids/memory/CPU limits, and no socket inside.

Today the app process talks to the Docker daemon for:

| Consumer | Needs |
|---|---|
| `DockerWorkspaceProvider` (`src/lib/agent-workspaces/providers/docker.ts`) | create, start, exec, files, snapshots: **write** access to the daemon |
| `processControl.ts`, `http-adapter.ts` | `docker logs` / `inspect` of the Hermes containers: read only |
| `control-plane/runtime.ts` | `docker inspect`: read only |
| `learning/sandbox.ts` `DockerSandbox` | `docker run` (Learning Core, parked) |

Target design:

1. **One holder of the socket.** Add a `workspace-runner` service built from the existing `worker` image. It mounts the socket, sits on an internal network, publishes no ports and has no Traefik route.
2. **Same interface, remote implementation.** The app already goes through `WorkspaceRuntimeProvider` (`providers/index.ts`). Add a `RemoteWorkspaceProvider` that calls the runner over `sentinel_net` with an HMAC-signed request. The runner hosts the unchanged `DockerWorkspaceProvider` behind a fixed list of operations and repeats the image and homePath allowlist checks. Estimated at about 200 lines, reusing the existing provider tests.
3. **Read-only inspection** (logs/inspect) goes through the same runner. A filtering socket proxy is **not** an acceptable substitute for step 2: any proxy that allows `POST /containers/create` also allows `--privileged` and host bind mounts.
4. **CLI agents run only in `orchestration-worker`.** The worker already has the CLI binaries and credentials, and no socket. `/api/chat` dispatches runtime turns through the existing orchestration queue instead of executing them in-process. After that, `app` loses the `runtime-agents` mounts entirely.
5. **Optional, on the host:** run workspace containers under gVisor (`--runtime=runsc`) or a user-namespace-remapped daemon.

Interim, without code changes: keep the Gemini CLI out of every container that has the socket, and grant `agent_workspace.create` / `execute` and runtime execute permissions only to admins.

## 4. Production migration and rollback checklists

Each section is a separate approval. Nothing here has been run.

### A. Deploy this branch

Before deploying:

1. Confirm production matches `main`: `curl -s https://sentinel.srv1427612.hstgr.cloud/api/version` returned `7b6e2e5` on 2026-10-19.
2. In `/opt/sentinel-os/.env`:
   - `SENTINEL_SIGNUP_ALLOWLIST=<operator emails or @domain>`. Without it, only existing accounts can sign in.
   - `AGENT_WORKSPACE_ALLOWED_IMAGES=<output of: SELECT DISTINCT image FROM agent_workspaces;>`. Existing workspaces start regardless; this covers new and default workspaces created from those images.
   - Optional: `MOBILE_TOKEN_TTL_SECONDS` (default 604800).
3. Confirm the operator administers `default`: `SELECT u.email FROM workspaces w JOIN users u ON u.id = w."ownerId" WHERE w.slug = 'default';`. Only owners or admins of `default` can now edit custom or installed modules.
4. If anyone uses `.env.development` in the VPS checkout, copy it aside before pulling. It is no longer tracked, so the pull removes it; restore it afterwards (it is now gitignored).
5. Validate the migration against a production dump: `scripts/deploy/validate-migrations.sh <dump>`. It adds one nullable column.
6. Deploy with `scripts/deploy/release.sh`, which takes a pg_dump and a Redis SAVE and pins the previous images.

After deploying, verify:

- `/api/version` reports the new SHA, and `/api/health` and `/api/ready` return 200.
- Operator web sign-in and mobile sign-in work, and existing mobile tokens still work (`mobileTokensRevokedAt` is NULL).
- `POST /api/auth/register` with a non-allowlisted email returns 403.
- On a test account, 10 wrong passwords followed by the correct one returns 429.

Rollback: `release.sh` rollback to the pinned images. The new column is nullable and the old code ignores it, so no down-migration is needed. The new environment variables are ignored by the old code.

Behaviour changes users will notice: registration is invitation-only; mobile tokens issued after the deploy expire in 7 days; global module settings are limited to admins of `default`.

### B. Rotate Postgres and Redis credentials

1. Generate the passwords with `openssl rand -hex 32` (hex keeps the connection URLs valid).
2. Postgres: `docker compose exec postgres psql -U hermes -d hermesos -c "ALTER USER hermes PASSWORD '<new>'"`, then set `POSTGRES_PASSWORD` and run `docker compose up -d migrate app learning-worker orchestration-worker`.
3. Redis: set `REDIS_PASSWORD`, then run `docker compose up -d redis app learning-worker orchestration-worker` in one step. The queue is unavailable for a few seconds.
4. Verify `/api/ready`, and run `docker compose port postgres 5432` (expect no output).

Rollback: `ALTER USER hermes PASSWORD 'hermes'`, unset both variables, and recreate the same services.

### C. Harden Hermes (host)

1. Take an inventory: `ss -tlnp | grep -E ':(486[0-9]|8977)'` and `ufw status verbose`.
2. Firewall-deny ports 4860–4864 and 8977 from the public interface. This step is reversible on its own.
3. Replace `network_mode: host` with a bridge network and `127.0.0.1:` port bindings. The app already reaches Hermes through `host.docker.internal`.
4. Run as a dedicated non-root uid: `chown -R` the data directories, set `HERMES_UID/GID`, and drop `HERMES_ALLOW_ROOT_GATEWAY`.
5. Give each profile its own container mount instead of co-mounting `lisa` and `client`.

Rollback: restore the previous compose file and the previous ownership (record `stat` output first).

### D. Workspace isolation (after §3 steps 1–4 merge)

1. Deploy `workspace-runner` alongside the app, which still has the socket. Switch the provider with a new flag introduced with §3 step 2 (for example `AGENT_WORKSPACE_PROVIDER=remote`) and run `scripts/agent-workspace-acceptance.ts`.
2. Remove the socket, `group_add`, the docker CLI and the `runtime-agents` mounts from `app`.
3. Verify from inside the app container that `ls /var/run/docker.sock` fails and `/opt/runtime-home` is absent.

Rollback: set the flag back to the local provider and restore the previous compose file.

## 5. Architecture map

**Modules.** 16 directories in `src/modules`. The v1 registry is gone; navigation lives in `src/lib/navigation.ts` and the catalog in `src/lib/modules/manifests.ts`.

**Learning Core and Neural Engine.** `src/lib/learning` (about 8.6k lines, 47 API routes) is a deliberate extension of `src/lib/neural-engine` (about 7.3k lines, 12 routes), per `docs/LEARNING_CORE_ON_NEURAL_ENGINE.md`. They are layered rather than duplicated, but they import each other in both directions (10 and 9 files). Combined, that is about 16k lines and 59 routes of self-improvement machinery that the primary product does not need this quarter.

**Graph rendering.** There are four renderers:

| Renderer | Library | Used by |
|---|---|---|
| Neural Lens globe | `three` (custom) | `/memory`, `/neural-lens` (canonical, see COMPONENTS.md) |
| Strata | canvas (custom) | Behind Chat (canonical) |
| GraphCanvas | `react-force-graph-2d` | `src/modules/graph` |
| KnowledgeGraph | `react-force-graph-3d` | Creator Studio only |

`@xyflow/react` serves only the org chart, which is a different kind of chart.
Recommendation: once Creator Studio is parked, retire `react-force-graph-3d`, and
decide whether `/graph` should be the globe.

**Kept on purpose, currently unused:** `src/lib/knowledge/decisions.ts` (decision
CRUD with no route), `src/lib/neural-engine/knowledge-service.ts`, and the lib barrels.
Remove them or wire them up once Phase 4 scope is confirmed.

## 6. Scope freeze (proposal for confirmation)

**Primary user:** one technical operator running a small fleet of AI agents
(Claude Code, Codex, Hermes bots) on their own server.

**Central problem:** delegating real work to several agents and keeping it
accountable. That means one place to talk to agents, dispatch tasks, see what
they did, approve risky actions, and have project context remembered.

**Minimum shippable product this quarter:** chat with agents, then tasks with
approvals, then isolated agent computers, then project-scoped memory, then an
activity/audit trail. All of it sits behind invitation-only auth.

| Class | Modules and surfaces |
|---|---|
| **CORE** | chat (runtime routing), agents (runtime and model control), tasks and orchestration with approvals, agent-workspaces, memory (retrieval), activity |
| **SUPPORTING** | auth and identity, workspaces and projects (tenancy), MCP gateway and OAuth, bots (Hermes routing used by chat), settings, search, health/ready/version, control-plane (deploy visibility), mission-control (approval queue) |
| **PARK** | Learning Core and the Neural Engine learning loop (learning-worker can be scaled to 0), System One, voice/LiveKit, creator-studio, studio/builder, marketing, cybersecurity, kanban (overlaps tasks), workflows, marketplace/custom modules, organization/org chart, standalone graph pages (neural-lens, orrery, `/graph`), the mobile app. Collaboration rooms and notes/obsidian are PARK pending a consumer check |
| **REMOVE** | Done: the v1 registry, unreachable UI, 9 dependencies. Next: `react-force-graph-3d` once Creator Studio is parked |

PARK means no new features: security and bug fixes only, and the module stays
deployed and reachable. Nothing is disabled because of this table.

## 7. Recommended minimum shippable architecture

```
Internet ─▶ Traefik ─▶ app (Next.js)            no docker socket, no host credentials
                         │  Postgres (auth)  Redis (auth)
                         ├─▶ orchestration queue ─▶ orchestration-worker   CLI runtimes + credentials, no socket
                         └─▶ workspace-runner (internal only) ─▶ Docker ─▶ hardened agent workspaces
Hermes (non-root, bridge network, localhost-bound) ◀── app / worker via host.docker.internal
learning-worker: parked (replicas 0)
```

## 8. Approvals required

1. Merge and deploy this branch (§4-A). It changes behaviour as listed there.
2. Rotate the Postgres and Redis credentials (§4-B).
3. Harden Hermes on the host (§4-C).
4. Implement the workspace-runner split and move CLI execution out of the app (§3), then roll it out (§4-D).
5. Confirm the scope freeze (§6).
6. Decide how to fix the schema drift (M4): regenerate `schema.prisma` from production introspection, or add a reconciling migration.
