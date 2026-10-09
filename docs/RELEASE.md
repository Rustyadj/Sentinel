# Releasing Sentinel

One release is one commit on `main`. Everything that runs Sentinel code — the app, the migration job and **both**
workers — is built from that commit, tagged with it, and checked against it. See ADR-009 in
[decisions.md](decisions.md).

## Before a release is called ready

All of these, on the exact commit that will be deployed:

| Check | How |
|---|---|
| lint, typecheck, unit/integration, build | CI `verify` (`npm run lint`, `typecheck`, `test`, `build`) |
| Prisma + migrations | CI `verify` (`prisma validate`, `migrate deploy`, `migrate status`) |
| Migrations against production data | `scripts/deploy/validate-migrations.sh <prod.dump> [base-ref]` (below) |
| Every image builds, carries the revision, holds no credentials | CI `docker` |
| Authenticated browser suite | CI `browser` (`tests/e2e/rc`, below) |
| Gate | CI `deploy-gate` requires all of the above |

## Migrations against a copy of production

Never against production. Take a dump with a read-only session, restore it into a disposable database, and replay:

```bash
docker exec -e PGOPTIONS="-c default_transaction_read_only=on" sentinel-os-postgres-1 \
  pg_dump -U hermes -d hermesos --format=custom > /root/rc-evidence/prod.dump && chmod 600 /root/rc-evidence/prod.dump
scripts/deploy/validate-migrations.sh /root/rc-evidence/prod.dump origin/main
```

It checks migration lineage and recorded checksums, applies the pending migrations, proves every table's row count is
unchanged, proves the release adds no schema drift (the production-vs-schema difference before equals the one after),
and proves the previous revision's `migrate deploy` is a no-op on the migrated database, so **rollback needs no
database change**. Migrations stay additive for exactly that reason. Delete the dump and the disposable container
afterwards; both hold production data.

## The browser suite

```bash
SENTINEL_RELEASE_SHA=<sha> docker compose build app migrate learning-worker orchestration-worker
SENTINEL_RELEASE_SHA=<sha> docker compose -f deploy/verify/docker-compose.yml up -d --wait
DATABASE_URL=postgresql://rc:rc-disposable@127.0.0.1:55510/rc npx tsx scripts/verify/seed-rc.ts
npm run test:rc
docker compose -f deploy/verify/docker-compose.yml down -v
```

The stack has its own Postgres/Redis, a **fake Hermes dashboard** (`tests/e2e/support/fake-hermes.mjs`), no Docker
socket and no host mounts, and publishes only on `127.0.0.1` (3190 app, 4900 fake, 55510 database). The Sentinel side
of every conversation is real code; the "agent" is scripted by markers in the prompt. It cannot spend credits or call an
external tool. It signs in through the real form as an owner, a member and a user of another workspace.

## Deploying

On the host that runs the compose project (from its checkout), with the 40-character sha of the head of `main`:

```bash
git fetch origin main && git show <sha>:scripts/deploy/release.sh | APP_DIR="$PWD" bash -s -- deploy <sha>
```

The workflow does the same over SSH. The script refuses, before touching anything running, a dirty checkout, a sha that
is not the head of `origin/main`, or a database backup that cannot be listed. It then builds all four images at the sha,
runs `migrate`, replaces app and both workers, waits for `/api/health`, `/api/ready` and each worker's healthcheck
(which only passes while the worker can round-trip to Postgres and Redis), and proves every container reports the sha
(env, image label, tag) and `/api/version` agrees. If anything fails after services were replaced, **every** service is
rolled back to the revision that was running. A backup (`postgres.dump`, `redis.rdb`, agents) and a `release.json` land in
`backups/releases/<time>-<sha>/`.

Production deploys from CI only on `workflow_dispatch`, or on a push to `main` while the repository variable
`SENTINEL_AUTODEPLOY` is `true`, and always through the `production` environment.

## Rolling back

Every deploy first pins the exact images the app and both workers are running (`snapshot.tsv`, `restore.compose.yml` in
`backups/releases/<time>-<sha>/`). Rolling back re-creates the containers from those images:

```bash
git show <release-sha>:scripts/deploy/release.sh | APP_DIR="$PWD" bash -s -- restore backups/releases/<time>-<sha>
```

The same thing runs automatically if a deploy fails after services were replaced. It does not depend on the previous
revision's compose file or source, which matters today: production's app was built from a hand-made override of PR #41's
commit, its workers from a different compose file, and the revision it reports has no orchestration worker at all. It runs
no migration and reverts none (migrations stay additive), refuses if a snapshot image has been pruned, verifies each
service is on its snapshot image and that the app reports the revision it had, and prints where the backups are if it
cannot finish. Restored legacy workers get their healthcheck disabled, since the heartbeat it relies on is new.

Once two releases built with this script exist, `release.sh rollback <earlier-sha>` also works: it rebuilds every service
from that revision. It refuses a revision whose compose file lacks any of the services, rather than let `--remove-orphans`
delete the one it does not define. Keep `docker image prune` away from `sentinel-os-rollback-*` images until the release
has settled.

## Repository protections to enable

Not applied by any code change; they are settings only an admin can make.

1. **`production` environment → Required reviewers** (and "Prevent self-review"), plus a deployment branch rule of `main`.
   Today it has no protection rules.
2. **Ruleset on `main`**: require a pull request, require the `Production readiness` checks (`verify`, `docker`, `smoke`,
   `browser`, `deploy-gate`), block force pushes and deletions.
3. Add the production secrets (`VPS_HOST`, `VPS_USER`, `VPS_SSH_KEY`, `VPS_KNOWN_HOSTS`, `VPS_APP_DIR`) to the
   `production` environment, not the repository. None exist now, so the CI deploy job cannot run; production is deployed
   by hand on the host.
4. Leave `SENTINEL_AUTODEPLOY` unset until (1) and (2) are in place.
