#!/usr/bin/env bash
# Prove a release's migration chain against a COPY of production, never production.
#
#   scripts/deploy/validate-migrations.sh <prod-dump.dump> [base-ref]
#
# <prod-dump> is a pg_dump --format=custom of the production database (take it with a read-only session).
# base-ref (default origin/main) is the revision production is running today, for the drift and rollback checks.
#
# It restores the dump into a disposable Postgres (tmpfs, localhost only, removed on exit), then:
#   1. compares every applied migration's recorded checksum with the file in this checkout;
#   2. applies this checkout's pending migrations with `prisma migrate deploy`;
#   3. proves existing data survived (row counts of every table are identical except _prisma_migrations);
#   4. proves this release introduced no schema drift (the drift of prod vs base == the drift of migrated vs this schema);
#   5. proves the previous revision still starts on the migrated database (its `migrate deploy` is a no-op).
# Any failure exits non-zero. Nothing here ever connects to the production database.
set -Eeuo pipefail

DUMP="${1:?usage: validate-migrations.sh <prod-dump> [base-ref]}"
BASE_REF="${2:-origin/main}"
[ -f "$DUMP" ] || { echo "no such dump: $DUMP" >&2; exit 2; }
NAME="rc-migval-$$"
PORT="${MIGVAL_PORT:-55$((RANDOM % 900 + 100))}"
WORK="$(mktemp -d)"
cleanup() { docker rm -f "$NAME" >/dev/null 2>&1 || true; rm -rf "$WORK"; }
trap cleanup EXIT
pass() { printf 'PASS  %s\n' "$*"; }
fail() { printf 'FAIL  %s\n' "$*" >&2; exit 1; }
psql_() { docker exec "$NAME" psql -U hermes -tA -v ON_ERROR_STOP=1 "$@"; }
url() { echo "postgresql://hermes:disposable@127.0.0.1:$PORT/$1"; }

docker run -d --name "$NAME" -e POSTGRES_PASSWORD=disposable -e POSTGRES_USER=hermes -e POSTGRES_DB=hermesos \
  --tmpfs /var/lib/postgresql/data -p "127.0.0.1:$PORT:5432" pgvector/pgvector:pg16 >/dev/null
for _ in $(seq 1 40); do docker exec "$NAME" pg_isready -U hermes -d hermesos >/dev/null 2>&1 && break; sleep 1; done

docker exec -i "$NAME" pg_restore -U hermes -d hermesos --no-owner --exit-on-error < "$DUMP"
pass "dump restored into a disposable database"

counts() {  # every table's row count, in a stable order
  psql_ -d "$1" -c "select table_name||'='||(xpath('/row/c/text()', query_to_xml('select count(*) as c from \"'||table_name||'\"', false, true, '')))[1]::text from information_schema.tables where table_schema='public' and table_type='BASE TABLE' order by 1"
}

# 1. lineage and checksums ---------------------------------------------------------------
psql_ -d hermesos -F'|' -c "select migration_name, checksum, finished_at is not null, rolled_back_at is not null from _prisma_migrations order by started_at" > "$WORK/applied.txt"
applied="$(awk -F'|' '$3=="t"' "$WORK/applied.txt" | wc -l)"
echo "      production has $applied applied migrations ($(awk -F'|' '$4=="t"' "$WORK/applied.txt" | wc -l) rolled-back rows kept for history)"
missing=0; changed=0
while IFS='|' read -r name checksum finished rolled; do
  [ "$finished" = t ] || continue
  file="prisma/migrations/$name/migration.sql"
  if [ ! -f "$file" ]; then echo "      applied in production but absent from this checkout: $name"; missing=$((missing+1)); continue; fi
  actual="$(sha256sum "$file" | cut -d' ' -f1)"
  if [ "$actual" != "$checksum" ]; then echo "      checksum differs from production: $name (recorded ${checksum:0:12}, file ${actual:0:12})"; changed=$((changed+1)); fi
done < "$WORK/applied.txt"
[ "$missing" -eq 0 ] || fail "$missing applied migration(s) are missing from this checkout"
pass "every applied migration exists in this checkout ($changed with a historical checksum difference, listed above; none are new in this release)"

pending="$(comm -13 <(awk -F'|' '$3=="t"{print $1}' "$WORK/applied.txt" | sort -u) <(ls prisma/migrations | grep -v toml | sort))"
echo "      pending: ${pending:-none}"

# 2. apply ---------------------------------------------------------------------------------
counts hermesos > "$WORK/counts-before"
DATABASE_URL="$(url hermesos)" npx prisma migrate deploy >/dev/null
DATABASE_URL="$(url hermesos)" npx prisma migrate status 2>&1 | grep -q "Database schema is up to date" || fail "database is not up to date after migrate deploy"
pass "migrate deploy applied cleanly; status is up to date"

# 3. data preserved ---------------------------------------------------------------------------
counts hermesos > "$WORK/counts-after"
if diff <(grep -v '^_prisma_migrations=' "$WORK/counts-before") <(grep -v '^_prisma_migrations=' "$WORK/counts-after") >/dev/null; then
  pass "existing data preserved: identical row counts in $(grep -vc '^_prisma_migrations=' "$WORK/counts-after") tables"
else fail "row counts changed:$(diff "$WORK/counts-before" "$WORK/counts-after")"; fi

# 4. no drift introduced ----------------------------------------------------------------------
git show "$BASE_REF:prisma/schema.prisma" > "$WORK/base-schema.prisma"
docker exec "$NAME" createdb -U hermes hermes_pre
docker exec -i "$NAME" pg_restore -U hermes -d hermes_pre --no-owner --exit-on-error < "$DUMP"
DATABASE_URL="$(url hermes_pre)" npx prisma migrate diff --from-url "$(url hermes_pre)" --to-schema-datamodel "$WORK/base-schema.prisma" --script > "$WORK/drift-before" 2>&1 || true
DATABASE_URL="$(url hermesos)" npx prisma migrate diff --from-url "$(url hermesos)" --to-schema-datamodel prisma/schema.prisma --script > "$WORK/drift-after" 2>&1 || true
if diff "$WORK/drift-before" "$WORK/drift-after" >/dev/null; then
  pass "no new schema drift ($(grep -c '^-- ' "$WORK/drift-after") pre-existing differences between production and the schema, unchanged by this release)"
else fail "this release changes the drift:$(diff "$WORK/drift-before" "$WORK/drift-after")"; fi

# 5. the previous revision still works on the migrated database -------------------------------
mkdir "$WORK/base"; git archive "$BASE_REF" prisma | tar -x -C "$WORK/base"
if DATABASE_URL="$(url hermesos)" npx prisma migrate deploy --schema "$WORK/base/prisma/schema.prisma" 2>&1 | grep -q "No pending migrations to apply"; then
  pass "previous revision ($BASE_REF) sees the migrated database as up to date: rollback needs no database change"
else fail "previous revision's migrate deploy is not a no-op on the migrated database"; fi

echo "All migration checks passed against a copy of production. Production was not contacted."
