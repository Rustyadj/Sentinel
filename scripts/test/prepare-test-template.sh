#!/usr/bin/env bash
# Build the template database the vitest suite clones for every run.
#
# Why a template at all: the suite used to run directly against one long-lived
# `sentinel_vitest` database. Nothing removed what a test wrote, so every run
# added rows to the same tables -- ~1.9k rows per run, ~62k accumulated by the
# time this was written. That is not just untidy: a decay/consolidation sweep
# that is supposed to see "the memories this test created" instead sees tens of
# thousands of rows from previous runs, so a sweep bug can pass here and fail
# in production. Tests were also getting slower as the tables grew.
#
# The fix is isolation, not deletion. This script builds ONE clean database
# (schema + the baseline rows the suite assumes). tests/global-setup.ts then
# does `CREATE DATABASE <run-specific> TEMPLATE <this>` before the run and
# drops it afterwards, so each run starts from exactly this state and leaves
# nothing behind. No DELETE statements against a shared database anywhere.
#
#   scripts/test/prepare-test-template.sh
#
# Re-run it whenever prisma/schema.prisma or the seeded baseline changes.
set -euo pipefail

CONTAINER="${SENTINEL_TEST_PG_CONTAINER:-sentinel-model-test-db}"
PGUSER="${SENTINEL_TEST_PG_USER:-postgres}"
PASSWORD="${SENTINEL_TEST_PG_PASSWORD:-sentinel_test}"
HOSTPORT="${SENTINEL_TEST_PG_HOSTPORT:-127.0.0.1:55439}"
TEMPLATE="${SENTINEL_TEST_TEMPLATE_DB:-sentinel_vitest_template}"

case "$TEMPLATE" in
  *hermesos*|*prod*) echo "refusing to build a template named '$TEMPLATE'" >&2; exit 1 ;;
esac

admin() { docker exec -e PGPASSWORD="$PASSWORD" "$CONTAINER" psql -U "$PGUSER" -d postgres -v ON_ERROR_STOP=1 -tAc "$1"; }

echo "==> dropping any leftover clones of $TEMPLATE"
admin "SELECT datname FROM pg_database WHERE datname LIKE '${TEMPLATE}\\_run\\_%';" | while read -r stale; do
  [ -n "$stale" ] && admin "DROP DATABASE IF EXISTS \"$stale\" WITH (FORCE);" >/dev/null
done

echo "==> recreating $TEMPLATE"
admin "DROP DATABASE IF EXISTS \"$TEMPLATE\" WITH (FORCE);" >/dev/null
admin "CREATE DATABASE \"$TEMPLATE\";" >/dev/null
docker exec -e PGPASSWORD="$PASSWORD" "$CONTAINER" psql -U "$PGUSER" -d "$TEMPLATE" -v ON_ERROR_STOP=1 -tAc \
  "CREATE EXTENSION IF NOT EXISTS vector;" >/dev/null

URL="postgresql://${PGUSER}:${PASSWORD}@${HOSTPORT}/${TEMPLATE}"

echo "==> pushing prisma/schema.prisma into $TEMPLATE"
DATABASE_URL="$URL" npx prisma db push --skip-generate --accept-data-loss >/dev/null

echo "==> seeding the baseline rows the suite assumes"
SENTINEL_TEST_PG_CONTAINER="$CONTAINER" SENTINEL_TEST_PG_DATABASE="$TEMPLATE" \
  scripts/test/seed-test-db.sh

echo "==> template ready: $TEMPLATE"
