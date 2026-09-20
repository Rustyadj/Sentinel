#!/usr/bin/env bash
# Prove the migration chain replays onto an empty database and lands where we
# expect. Run in CI and before any release that touches prisma/migrations.
#
# This is the slow, real check. tests/migrations/chain-integrity.test.ts is the
# fast static guard for the same class of bug.
#
#   scripts/test/migration-replay.sh
#
# Never point this at production: it creates and drops its own database.
set -euo pipefail

CONTAINER="${SENTINEL_TEST_PG_CONTAINER:-sentinel-model-test-db}"
DBNAME="${MIGRATION_REPLAY_DB:-migration_replay}"
PGUSER="${SENTINEL_TEST_PG_USER:-postgres}"
HOSTPORT="${SENTINEL_TEST_PG_HOSTPORT:-127.0.0.1:55439}"
PASSWORD="${SENTINEL_TEST_PG_PASSWORD:-sentinel_test}"
URL="postgresql://${PGUSER}:${PASSWORD}@${HOSTPORT}/${DBNAME}"

case "$DBNAME" in
  *hermesos*|*prod*) echo "refusing to replay into '$DBNAME'" >&2; exit 1 ;;
esac

cleanup() {
  docker exec "$CONTAINER" psql -U "$PGUSER" -tAc "DROP DATABASE IF EXISTS \"$DBNAME\" WITH (FORCE);" >/dev/null 2>&1 || true
}
trap cleanup EXIT

echo "==> creating throwaway database $DBNAME"
cleanup
docker exec "$CONTAINER" psql -U "$PGUSER" -tAc "CREATE DATABASE \"$DBNAME\";" >/dev/null
docker exec "$CONTAINER" psql -U "$PGUSER" -d "$DBNAME" -tAc "CREATE EXTENSION IF NOT EXISTS vector;" >/dev/null

echo "==> replaying the full migration chain from empty"
DATABASE_URL="$URL" npx prisma migrate deploy

echo "==> confirming prisma considers the chain settled"
DATABASE_URL="$URL" npx prisma migrate status

# The chain converges on the schema production actually has, which is NOT yet
# identical to schema.prisma -- documents.agentId/history and several column
# defaults differ in both places alike. That residual drift is a separate,
# pre-existing decision (it would require dropping columns in production), so
# this script reports it rather than failing on it. See docs/MEMORY_ENGINE.md
# and the migration notes in 20260705010000_workspace_operating_model.
echo "==> residual drift between the replayed schema and schema.prisma"
DATABASE_URL="$URL" npx prisma migrate diff \
  --from-url "$URL" \
  --to-schema-datamodel prisma/schema.prisma \
  --script || true

echo "==> replay OK"
