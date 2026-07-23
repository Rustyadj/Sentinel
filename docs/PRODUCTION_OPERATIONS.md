# Sentinel OS production operations

## Adaptive memory release gate

Apply `20260723090000_adaptive_memory_skill_refinery` with `prisma migrate
deploy` before starting the new image. Redis is required for working memory;
the service fails visibly when it is absent. Configure `MCP_CREDENTIAL_PEPPER`,
terminate TLS at the ingress, provision only short-lived scoped clients, and
schedule reflection/consolidation externally. Full procedures are in
[adaptive-memory/OPERATIONS.md](adaptive-memory/OPERATIONS.md) and
[adaptive-memory/ROLLBACK.md](adaptive-memory/ROLLBACK.md).

## Release gate

Deploy only an immutable commit that has passed lint, typecheck, unit tests, production build, Prisma migration validation, Playwright smoke tests, and Docker build. The GitHub Actions `deploy-gate` job is the required status check. On a push to `main`, `deploy-production` runs only after that gate succeeds and deploys the exact `${{ github.sha }}` in detached mode.

Configure the protected GitHub `production` environment with `VPS_HOST`, `VPS_USER`, `VPS_SSH_PORT`, `VPS_APP_DIR`, `VPS_SSH_KEY`, and a pinned `VPS_KNOWN_HOSTS` entry. Require a reviewer for that environment when releases need an explicit human gate.

## Required environment

- `DATABASE_URL`: PostgreSQL 16 with pgvector, least-privilege application credentials.
- `REDIS_URL`: persistent Redis endpoint. `/api/ready` fails when it is missing.
- `AUTH_SECRET`: at least 32 random bytes. Never reuse CI or development values.
- `AUTH_URL`: canonical HTTPS origin.
- OAuth client IDs/secrets as configured in `src/auth.ts`.
- `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, or `OPENROUTER_API_KEY`: server-only provider credentials. Browser-supplied keys are disabled in production unless `ALLOW_BROWSER_PROVIDER_KEYS=true` is deliberately set.
- `HERMES_ENDPOINT`, `HERMES_CLINT_ENDPOINT`, `OPENCLAW_ENDPOINT`: private agent health endpoints.
- `AGENT_CONFIG_DIR`, `AGENT_LOG_DIR`: dedicated mounted paths. Do not mount `/` or a home directory.
- `SENTINEL_TELEMETRY_URL`, `SENTINEL_TELEMETRY_TOKEN`: optional authenticated VPS telemetry collector. When absent or stale, Mission Control renders host, container, network, and runtime metrics as unavailable or stale rather than substituting sample data.

## VPS deployment

1. Fetch `main` and require `origin/main` to equal the immutable GitHub Actions release SHA.
2. Copy the production environment file from the secrets manager; never store it in Git.
3. Run `docker compose config` and inspect resolved images, mounts, networks, and ports.
4. Back up PostgreSQL, Redis, and agent configuration volumes into the release-specific backup directory before changing the checkout.
5. Run `docker compose build --pull`.
6. Run `docker compose run --rm migrate` and verify `npx prisma migrate status` reports no pending or failed migration.
7. Run `docker compose up -d --remove-orphans`.
8. Require HTTP 200 from both `/api/health` and `/api/ready`; `/api/ready` includes DB, Redis, and every registered agent. If either fails, restore and rebuild the previous application SHA automatically.
9. Exercise Mission Control, Chat, Organization, and Agents with an owner and a member account.

## Backups and restore

- PostgreSQL: nightly `pg_dump --format=custom`, encrypted off-host, with a weekly test restore.
- Redis: persist AOF/RDB and snapshot the volume. Redis is not the source of truth.
- Agent configuration: snapshot `agent_configs` before every edit/deploy. Sentinel also creates per-file backups before save.
- Restore into an isolated host first, run migrations, validate record counts and project-scope tests, then switch traffic.

## Migrations and rollback

Migrations are forward-only in production. Back up first, run `prisma migrate deploy`, and retain the previous application image. If the application fails but the migration is compatible, roll back the image. If data repair is required, stop writes, restore the pre-migration database, restore the previous image, and document the incident. Never use `prisma db push` in production.

## Secret rotation

Rotate provider/OAuth secrets independently, restart only the app container, and verify authentication plus chat. Rotating `AUTH_SECRET` invalidates sessions and requires an announced maintenance window. Revoke the old value after successful verification and audit access logs.

## Agent control plane

Only database-backed workspace owners/admins can edit config or reload/restart agents. Agent IDs and Docker operations are allowlisted; browser requests cannot supply commands. Config paths and extensions are constrained, validated, backed up, and written server-side. Keep the legacy agent UI available through each registry `legacyPath` while Sentinel control operations are degraded.

## Disaster recovery

Target order: database, authentication, Sentinel app, Redis, agents, then legacy links. Restore the latest verified backups, deploy the last green image, run readiness checks, validate project isolation with two test projects, rotate credentials if compromise is suspected, and record recovery point/recovery time. Keep DNS/TLS and VPS rebuild instructions outside the failed host.

## Current data-boundary audit

Projects, workspaces, teams, roles, approvals, tasks, meetings, documents, chat, knowledge objects, notes, and agent controls have server-side adapters or database routes. Mission Control has no operational fallback: each card identifies its real source as live, stale, unavailable, or explicitly demo. Approval and learning-review actions use their authenticated database APIs. Cybersecurity, AI Studio, Marketing, and the legacy Memory page still contain presentation fixtures; they are not production sources of truth and must not be used for decisions or control actions. Production rollout should either connect those modules to typed APIs or render an unavailable/empty state.
