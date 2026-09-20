#!/usr/bin/env bash
# Seed the throwaway vitest database with the baseline rows the suite assumes.
#
# The suite was written against the live application database, where a default
# workspace, the well-known agents (hermes-nathan2, gemini, ...) and the static
# agent_runtimes rows all already exist — they are inserted by data-carrying
# migrations. The test database is built with `prisma db push`, which creates
# the tables but runs none of those INSERTs.
#
# (This used to note that the migration chain could not replay from scratch
# because two migrations both add agents.description. That is fixed -- see the
# idempotency note in 20260705010000_workspace_operating_model, and
# scripts/test/migration-replay.sh, which proves the replay. `db push` is kept
# here because it is faster, not because replay is broken.)
#
# This replays just the data portions, idempotently.
set -euo pipefail

CONTAINER="${SENTINEL_TEST_PG_CONTAINER:-sentinel-model-test-db}"
DBNAME="${SENTINEL_TEST_PG_DATABASE:-sentinel_vitest}"
psql() { docker exec -i "$CONTAINER" psql -U postgres -d "$DBNAME" -v ON_ERROR_STOP=0 -q "$@"; }

psql <<'SQL'
INSERT INTO "users" ("id","email","name")
VALUES ('test-seed-owner','seed@sentinel.test','Seed Owner')
ON CONFLICT ("id") DO NOTHING;

INSERT INTO "workspaces" ("id","slug","name","ownerId","updatedAt")
VALUES ('test-seed-default','default','Default','test-seed-owner',CURRENT_TIMESTAMP)
ON CONFLICT ("slug") DO NOTHING;
SQL

for migration in \
  20260802120000_agent_runtime_control_plane \
  20260820063000_collaboration_room \
  20260906090000_agent_model_control \
  20260907020000_gemini_runtime
do
  file="prisma/migrations/${migration}/migration.sql"
  [ -f "$file" ] || { echo "missing $file" >&2; exit 1; }
  # Data statements only — every DDL statement in these files was already
  # applied by `prisma db push`, and replaying it would just raise noise.
  awk '/^INSERT INTO/,/;[[:space:]]*$/' "$file" | psql 2>&1 | grep -viE '^$|^INSERT|^UPDATE|^SELECT' || true
done

psql -c "SELECT (SELECT count(*) FROM agents) AS agents, (SELECT count(*) FROM agent_runtimes) AS runtimes, (SELECT count(*) FROM workspaces) AS workspaces;"
