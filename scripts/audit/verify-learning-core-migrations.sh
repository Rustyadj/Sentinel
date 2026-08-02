#!/usr/bin/env bash
set -euo pipefail

: "${FRESH_DATABASE_URL:?Set FRESH_DATABASE_URL to an empty PostgreSQL 16 database}"
: "${UPGRADE_DATABASE_URL:?Set UPGRADE_DATABASE_URL to a current-main-shaped PostgreSQL 16 database}"

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$repo_root"

prisma_cli=(node node_modules/prisma/build/index.js)

DATABASE_URL="$FRESH_DATABASE_URL" "${prisma_cli[@]}" validate --schema prisma/schema.prisma

verify_database() {
  local label="$1"
  local database_url="$2"

  echo "Verifying Learning Core migrations on ${label} database"
  DATABASE_URL="$database_url" "${prisma_cli[@]}" migrate deploy --schema prisma/schema.prisma
  DATABASE_URL="$database_url" node --input-type=module <<'NODE'
import { PrismaClient } from "@prisma/client";

const db = new PrismaClient();
try {
  const rows = await db.$queryRawUnsafe(`
    SELECT
      to_regclass('public.learning_events') IS NOT NULL AS learning_events,
      to_regclass('public.learning_skill_versions') IS NOT NULL AS skill_versions,
      to_regclass('public.learning_feature_flags') IS NOT NULL AS feature_flags,
      EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'neural_learning_candidates'
          AND column_name = 'approvalRequestId'
      ) AS approval_link,
      EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'learning_skill_versions'
          AND column_name = 'retiredAt'
      ) AS retired_at,
      EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'learning_feature_flags_learningCandidateId_fkey'
      ) AS feature_flag_candidate_fk
  `);
  const integrity = rows[0];
  if (!integrity || Object.values(integrity).some((value) => value !== true)) {
    throw new Error(`Learning Core integrity check failed: ${JSON.stringify(integrity)}`);
  }
  console.log(JSON.stringify(integrity));
} finally {
  await db.$disconnect();
}
NODE
}

verify_database "fresh" "$FRESH_DATABASE_URL"
verify_database "upgrade" "$UPGRADE_DATABASE_URL"
