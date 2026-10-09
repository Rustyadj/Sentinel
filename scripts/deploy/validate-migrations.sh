#!/usr/bin/env bash
# Prove a release's migration chain against a COPY of production, never production.
#
#   scripts/deploy/validate-migrations.sh <prod-dump.dump> [base-ref]
#
# <prod-dump> is a pg_dump --format=custom of the production database (take it with a read-only session).
# base-ref (default origin/main) is the revision production runs today. It is the baseline for the drift and
# old-application checks, so it MUST describe production's migration lineage: when production's applied
# migrations are not exactly base-ref's, the default is refused and the correct revision has to be named.
#
# It restores the dump into a disposable Postgres (tmpfs, localhost only, removed on exit), then:
#   1. checks lineage: no unresolved failed migration records; production's applied set == the baseline's;
#      every recorded checksum matches this checkout unless a pinned, evidenced exception covers it AND the
#      baseline already carried the same file (so the difference predates this release);
#   2. applies this checkout's pending migrations with `prisma migrate deploy`;
#   3. proves existing data survived (row counts of every table identical except _prisma_migrations);
#   4. proves the retention backfill produced the right VALUES, row by row, not just the right counts;
#   5. proves this release introduced no schema drift, and that a failing diff command is a failure
#      (two identical errors are not "no difference");
#   6. proves the previous revision's schema still fits the migrated database (every statement that would be
#      needed to make the migrated database match the baseline schema must only DROP things this release added).
#      `migrate deploy` being a no-op for the previous revision is reported, but it only compares migration
#      NAMES; it says nothing about whether the old application still works.
# Any failure exits non-zero. Nothing here ever connects to the production database.
#
# Checksum exceptions: scripts/deploy/migration-checksum-exceptions.txt (override: MIGVAL_CHECKSUM_EXCEPTIONS),
# one per line:  <migration> <checksum production recorded> <checksum of the file now> <evidence...>
set -Eeuo pipefail

DUMP="${1:?usage: validate-migrations.sh <prod-dump> [base-ref]}"
BASE_REF="${2:-origin/main}"
BASE_EXPLICIT=0; [ -n "${2:-}" ] && BASE_EXPLICIT=1
EXCEPTIONS="${MIGVAL_CHECKSUM_EXCEPTIONS:-scripts/deploy/migration-checksum-exceptions.txt}"
[ -f "$DUMP" ] || { echo "no such dump: $DUMP" >&2; exit 2; }
NAME="rc-migval-$$"
PORT="${MIGVAL_PORT:-55$((RANDOM % 900 + 100))}"
WORK="$(mktemp -d)"
cleanup() { docker rm -f "$NAME" >/dev/null 2>&1 || true; rm -rf "$WORK"; }
trap cleanup EXIT
pass() { printf 'PASS  %s\n' "$*"; }
fail() { printf 'FAIL  %s\n' "$*" >&2; exit 1; }
note() { printf '      %s\n' "$*"; }

# Nothing in the caller's environment may point a client at a real database.
unset PGHOST PGHOSTADDR PGPORT PGSERVICE PGSERVICEFILE PGPASSFILE PGDATABASE PGUSER PGPASSWORD DIRECT_URL SHADOW_DATABASE_URL
psql_() { docker exec "$NAME" psql -U hermes -tA -v ON_ERROR_STOP=1 "$@"; }
url() { echo "postgresql://hermes:disposable@127.0.0.1:$PORT/$1"; }
prisma_() { local db="$1"; shift; DATABASE_URL="$(url "$db")" npx prisma "$@"; }

BASE_COMMIT="$(git rev-parse --verify --quiet "$BASE_REF^{commit}")" || fail "baseline '$BASE_REF' is not a revision in this checkout"

docker run -d --name "$NAME" -e POSTGRES_PASSWORD=disposable -e POSTGRES_USER=hermes -e POSTGRES_DB=hermesos \
  --tmpfs /var/lib/postgresql/data -p "127.0.0.1:$PORT:5432" pgvector/pgvector:pg16 >/dev/null
for _ in $(seq 1 40); do docker exec "$NAME" pg_isready -U hermes -d hermesos >/dev/null 2>&1 && break; sleep 1; done

docker exec -i "$NAME" pg_restore -U hermes -d hermesos --no-owner --exit-on-error < "$DUMP"
pass "dump restored into a disposable database"

counts() {  # every table's row count, in a stable order
  psql_ -d "$1" -c "/*counts*/ select table_name||'='||(xpath('/row/c/text()', query_to_xml('select count(*) as c from \"'||table_name||'\"', false, true, '')))[1]::text from information_schema.tables where table_schema='public' and table_type='BASE TABLE' order by 1"
}
stamp() { psql_ -d hermesos -c "/*clock*/ select to_char(clock_timestamp(), 'YYYY-MM-DD\"T\"HH24:MI:SS.US')"; }

# 1. lineage and checksums ---------------------------------------------------------------
psql_ -d hermesos -F'|' -c "/*applied*/ select migration_name, checksum, finished_at is not null, rolled_back_at is not null from _prisma_migrations order by started_at, migration_name" > "$WORK/applied.txt"
# A started migration that neither finished nor was resolved as rolled back is a FAILED migration: production is mid-incident.
awk -F'|' '$3!="t" && $4!="t"{print $1}' "$WORK/applied.txt" > "$WORK/unresolved.txt"
if [ -s "$WORK/unresolved.txt" ]; then
  fail "production has unresolved failed migration record(s): $(paste -sd, "$WORK/unresolved.txt"). Resolve them (prisma migrate resolve) and re-take the dump before validating a release"
fi
awk -F'|' '$3=="t"{print $1}' "$WORK/applied.txt" | sort -u > "$WORK/applied-names.txt"
note "production has $(wc -l < "$WORK/applied-names.txt") applied migrations ($(awk -F'|' '$4=="t"' "$WORK/applied.txt" | wc -l) rolled-back rows kept for history)"

git ls-tree -d --name-only "$BASE_COMMIT" prisma/migrations/ | sed 's#.*/##' | sort -u > "$WORK/base-names.txt"
only_prod="$(comm -23 "$WORK/applied-names.txt" "$WORK/base-names.txt" | paste -sd, -)"
only_base="$(comm -13 "$WORK/applied-names.txt" "$WORK/base-names.txt" | paste -sd, -)"
if [ -n "$only_prod$only_base" ]; then
  hint=$([ "$BASE_EXPLICIT" = 1 ] && echo "'$BASE_REF' does not describe what production runs" || echo "the default baseline ($BASE_REF) is not what production runs; name the revision production actually runs as the second argument")
  fail "production's migration lineage differs from the baseline: $hint. Applied in production but not in the baseline: ${only_prod:-none}. In the baseline but not applied in production: ${only_base:-none}"
fi
pass "production's applied migrations are exactly the baseline's ($BASE_REF = ${BASE_COMMIT:0:12})"

missing=0; unexplained=0; excused=0
while IFS='|' read -r name checksum finished rolled; do
  [ "$finished" = t ] || continue
  file="prisma/migrations/$name/migration.sql"
  if [ ! -f "$file" ]; then note "applied in production but absent from this checkout: $name"; missing=$((missing+1)); continue; fi
  actual="$(sha256sum "$file" | cut -d' ' -f1)"
  [ "$actual" = "$checksum" ] && continue
  baseline="$(git show "$BASE_COMMIT:$file" 2>/dev/null | sha256sum | cut -d' ' -f1)"
  evidence=""
  [ -f "$EXCEPTIONS" ] && evidence="$(awk -v n="$name" -v r="$checksum" -v c="$actual" '$1==n && $2==r && $3==c && NF>=4 {$1=$2=$3=""; sub(/^ +/,""); print; exit}' "$EXCEPTIONS")"
  if [ -z "$evidence" ]; then
    note "UNEXPLAINED checksum difference: $name (production ${checksum:0:12}, file ${actual:0:12}); no pinned exception with evidence"
    unexplained=$((unexplained+1))
  elif [ "$baseline" != "$actual" ]; then
    note "checksum difference is NEW in this release: $name (baseline file ${baseline:0:12}, file ${actual:0:12}); an applied migration was edited"
    unexplained=$((unexplained+1))
  else
    note "excused historical checksum difference: $name — $evidence"
    excused=$((excused+1))
  fi
done < "$WORK/applied.txt"
[ "$missing" -eq 0 ] || fail "$missing applied migration(s) are missing from this checkout"
[ "$unexplained" -eq 0 ] || fail "$unexplained applied migration(s) have a checksum that differs from production without an evidenced exception that the baseline already carried"
pass "every applied migration matches its recorded checksum ($excused excused by pinned evidence)"

pending="$(comm -13 "$WORK/applied-names.txt" <(ls prisma/migrations | grep -v toml | sort))"
note "pending: $(echo "${pending:-none}" | paste -sd' ' -)"

# Pre-migration snapshot of what the retention backfill reads.
RETENTION=0; echo "$pending" | grep -q '_memory_expiry$' && RETENTION=1
if [ "$RETENTION" = 1 ]; then
  psql_ -d hermesos -F'|' -c "/*mem-pre*/ select id, coalesce(to_char(\"validTo\", 'YYYY-MM-DD\"T\"HH24:MI:SS.US'), ''), (source like 'bot:%' and \"supersededById\" is null and \"validTo\" is not null)::text from memories order by id" > "$WORK/mem-pre.txt"
fi

# 2. apply ---------------------------------------------------------------------------------
counts hermesos > "$WORK/counts-before"
T0="$(stamp)"
prisma_ hermesos migrate deploy >/dev/null || fail "prisma migrate deploy failed on the production copy"
T1="$(stamp)"
prisma_ hermesos migrate status 2>&1 | grep -q "Database schema is up to date" || fail "database is not up to date after migrate deploy"
pass "migrate deploy applied cleanly; status is up to date"

# 3. data preserved ---------------------------------------------------------------------------
counts hermesos > "$WORK/counts-after"
# Every table that existed before must have exactly its old row count. A table this release adds is new, not "changed".
awk -F= 'FNR==NR { if ($1!="_prisma_migrations") before[$1]=$2; next }
         $1=="_prisma_migrations" { next }
         { if ($1 in before) { if (before[$1]!=$2) print "  " $1 ": " before[$1] " -> " $2; delete before[$1] } else print "  " $1 ": new table, " $2 " rows (informational)" > "/dev/stderr" }
         END { for (t in before) print "  " t ": " before[t] " -> table is gone" }' \
  "$WORK/counts-before" "$WORK/counts-after" > "$WORK/counts-diff" 2> "$WORK/counts-new"
if [ ! -s "$WORK/counts-diff" ]; then
  pass "existing data preserved: identical row counts in $(grep -vc '^_prisma_migrations=' "$WORK/counts-before") tables$(if [ -s "$WORK/counts-new" ]; then echo "; new tables: $(sed 's/^ *//; s/: new table.*//' "$WORK/counts-new" | paste -sd, -)"; fi)"
else fail "row counts changed:$(printf '\n'; cat "$WORK/counts-diff")"; fi

# 4. retention backfill values ------------------------------------------------------------------
# Rule (20261008000000_memory_expiry): a bot memory with no successor and a validTo after the migration ran is a
# retention deadline: expiresAt takes the old validTo and validTo becomes NULL. Everything else must be untouched
# (same validTo, no expiresAt). A deadline that fell between T0 and T1 may legitimately go either way.
if [ "$RETENTION" = 1 ]; then
  psql_ -d hermesos -F'|' -c "/*mem-post*/ select id, coalesce(to_char(\"validTo\", 'YYYY-MM-DD\"T\"HH24:MI:SS.US'), ''), coalesce(to_char(\"expiresAt\", 'YYYY-MM-DD\"T\"HH24:MI:SS.US'), '') from memories order by id" > "$WORK/mem-post.txt"
  awk -F'|' -v t0="$T0" -v t1="$T1" '
    FNR==NR { vt[$1]=$2; cand[$1]=$3; next }
    { seen[$1]=1
      if (!($1 in vt)) next
      if (cand[$1]=="true" && vt[$1] > t1) { moved++; if ($2 != "" || $3 != vt[$1]) { bad++; if (bad<=5) print "  backfill wrong for " $1 ": want validTo NULL, expiresAt " vt[$1] "; got validTo [" $2 "], expiresAt [" $3 "]" } }
      else if (cand[$1]=="true" && vt[$1] > t0) { grey++; if (!(($2=="" && $3==vt[$1]) || ($2==vt[$1] && $3==""))) { bad++; if (bad<=5) print "  boundary row " $1 " in neither state: validTo [" $2 "], expiresAt [" $3 "]" } }
      else { kept++; if ($2 != vt[$1] || $3 != "") { bad++; if (bad<=5) print "  row " $1 " should be untouched (validTo " vt[$1] "): got validTo [" $2 "], expiresAt [" $3 "]" } }
    }
    END { for (id in vt) if (!(id in seen)) { bad++; if (bad<=5) print "  memory " id " disappeared" }
          printf "SUMMARY moved=%d boundary=%d untouched=%d bad=%d\n", moved, grey, kept, bad }
  ' "$WORK/mem-pre.txt" "$WORK/mem-post.txt" > "$WORK/retention.txt"
  summary="$(grep '^SUMMARY' "$WORK/retention.txt")"
  if ! echo "$summary" | grep -q 'bad=0$'; then fail "retention backfill produced wrong values ($summary):$(printf '\n'; grep -v '^SUMMARY' "$WORK/retention.txt")"; fi
  invariants="$(psql_ -d hermesos -c "/*mem-invariants*/ select count(*) from memories where \"expiresAt\" is not null and (source not like 'bot:%' or \"supersededById\" is not null or \"validTo\" is not null)")"
  [ "$invariants" = 0 ] || fail "retention invariant broken: $invariants memories have an expiresAt that is not a bot retention deadline"
  moved="$(echo "$summary" | sed -n 's/.*moved=\([0-9]*\).*/\1/p')"
  if [ "${moved:-0}" -gt 0 ]; then pass "retention backfill correct for $moved memories (values checked row by row; $summary)"
  else note "WARN  this dump has no bot memory with a future retention deadline, so the backfill rule was NOT exercised against real data ($summary). Row checks passed vacuously"; fi
else
  note "retention backfill migration is not pending; its data checks do not apply"
fi

# 5. no drift introduced ----------------------------------------------------------------------
git show "$BASE_COMMIT:prisma/schema.prisma" > "$WORK/base-schema.prisma"
docker exec "$NAME" createdb -U hermes hermes_pre
docker exec -i "$NAME" pg_restore -U hermes -d hermes_pre --no-owner --exit-on-error < "$DUMP"
# A diff command that errors proves nothing. Capture each one's own exit status and stderr; two identical errors
# compare equal, so equality must never be consulted until both have succeeded.
run_diff() {  # run_diff <label> <from-db> <to-schema>
  local label="$1" from="$2" to="$3"
  if ! prisma_ "$from" migrate diff --from-url "$(url "$from")" --to-schema-datamodel "$to" --script > "$WORK/$label.out" 2> "$WORK/$label.err"; then
    fail "schema diff '$label' failed (it must not be treated as 'no difference'): $(head -c 600 "$WORK/$label.err")$(head -c 300 "$WORK/$label.out")"
  fi
}
run_diff drift-before hermes_pre "$WORK/base-schema.prisma"
run_diff drift-after hermesos prisma/schema.prisma
if diff "$WORK/drift-before.out" "$WORK/drift-after.out" >/dev/null; then
  pass "no new schema drift ($(grep -c '^-- ' "$WORK/drift-after.out" || true) pre-existing differences between production and the schema, unchanged by this release)"
else fail "this release changes the drift:$(diff "$WORK/drift-before.out" "$WORK/drift-after.out")"; fi

# 6. the previous revision still fits the migrated database ---------------------------------------
# What it takes to turn the migrated database back into the baseline's schema. Statements production already needs
# (pre-existing drift) are ignored; of the rest, only DROPs are compatible — they remove what this release added and
# the old application never mentions. A CREATE, ADD COLUMN, SET NOT NULL, ALTER TYPE or RENAME means the old
# application expects something the migration took away or reshaped.
run_diff old-app hermesos "$WORK/base-schema.prisma"
statements() { sed '/^--/d' "$1" | awk 'BEGIN{RS=";\n"} {gsub(/\n/," "); gsub(/ +/," "); sub(/^ /,""); if ($0!="") print $0}' | sort -u; }
statements "$WORK/old-app.out" > "$WORK/old-app.stmts"
statements "$WORK/drift-before.out" > "$WORK/drift-before.stmts"
comm -23 "$WORK/old-app.stmts" "$WORK/drift-before.stmts" > "$WORK/old-app.new"
# Compatible: DROP TABLE/INDEX/..., or an ALTER TABLE that only drops a column, constraint or default. A statement that
# also adds, retypes, renames or re-requires anything is breaking even if it starts with DROP.
{ grep -viE '^(DROP |ALTER TABLE "[^"]+" (DROP |ALTER COLUMN "[^"]+" DROP DEFAULT))' "$WORK/old-app.new" || true
  grep -iE ' ADD | SET NOT NULL| SET DATA TYPE| TYPE | RENAME | SET DEFAULT' "$WORK/old-app.new" || true; } | sort -u > "$WORK/old-app.breaking"
# A column this release ADDED (the old schema's DROP COLUMN) to an existing table must not be NOT NULL without a default:
# the old application's INSERTs never mention it and would start failing.
while IFS= read -r stmt; do
  table="$(echo "$stmt" | sed -n 's/^ALTER TABLE "\([^"]*\)" DROP COLUMN "\([^"]*\)".*/\1/ip')"; column="$(echo "$stmt" | sed -n 's/^ALTER TABLE "\([^"]*\)" DROP COLUMN "\([^"]*\)".*/\2/ip')"
  [ -n "$table" ] || continue
  required="$(psql_ -d hermesos -c "/*notnull*/ select count(*) from information_schema.columns where table_schema='public' and table_name='$table' and column_name='$column' and is_nullable='NO' and column_default is null")"
  [ "$required" = 0 ] || echo "ALTER TABLE \"$table\" ADD COLUMN \"$column\" is NOT NULL with no default: the previous revision's INSERTs would fail" >> "$WORK/old-app.breaking"
done < "$WORK/old-app.new"
if [ -s "$WORK/old-app.breaking" ]; then
  fail "the previous revision ($BASE_REF) would not fit the migrated database; it expects:$(printf '\n'; head -n 8 "$WORK/old-app.breaking" | sed 's/^/        /')"
fi
pass "previous revision's schema fits the migrated database: $(wc -l < "$WORK/old-app.new" | tr -d ' ') statement(s) differ from it, all of them DROPs of objects added by this release"
mkdir "$WORK/base"; git archive "$BASE_COMMIT" prisma | tar -x -C "$WORK/base"
if prisma_ hermesos migrate deploy --schema "$WORK/base/prisma/schema.prisma" 2>&1 | grep -q "No pending migrations to apply"; then
  note "(and the previous revision's migration list is a subset of what is applied: its 'migrate deploy' is a no-op. That compares names only and is not the compatibility check above.)"
else fail "previous revision's migrate deploy is not a no-op on the migrated database"; fi

echo "All migration checks passed against a copy of production. Production was not contacted."
