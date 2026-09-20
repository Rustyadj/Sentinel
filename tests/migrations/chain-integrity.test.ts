// The migration chain must be able to replay from an empty database.
//
// It could not, for three months. 20260705010000_workspace_operating_model was
// generated on a lineage that did not contain three earlier migrations, so
// replayed in committed order it re-created tables and re-added columns that
// already existed. Production never noticed because the objects were already
// there from a `prisma db push` and the migration was eventually marked
// applied by hand — but every fresh environment (including the test database,
// which is why scripts/test/seed-test-db.sh exists) hit it.
//
// A full replay needs a live PostgreSQL and takes minutes; that lives in
// scripts/test/migration-replay.sh and runs in CI. This test is the fast
// static guard that stops the same class of divergence being committed again.

import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const MIGRATIONS_DIR = join(process.cwd(), "prisma", "migrations");

interface Statement {
  migration: string;
  guarded: boolean;
}

function migrationFiles(): Array<{ name: string; sql: string }> {
  return readdirSync(MIGRATIONS_DIR, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort()
    .map((name) => ({ name, sql: readFileSync(join(MIGRATIONS_DIR, name, "migration.sql"), "utf8") }));
}

/** Strip `--` comments so the commentary explaining a duplicate is never
 *  mistaken for the duplicate itself. */
function stripComments(sql: string): string {
  return sql
    .split("\n")
    .filter((line) => !line.trimStart().startsWith("--"))
    .join("\n");
}

function collect(): { creates: Map<string, Statement[]>; adds: Map<string, Statement[]> } {
  const creates = new Map<string, Statement[]>();
  const adds = new Map<string, Statement[]>();

  for (const { name, sql } of migrationFiles()) {
    const body = stripComments(sql);

    for (const match of body.matchAll(/CREATE TABLE\s+(IF NOT EXISTS\s+)?"([^"]+)"/gi)) {
      const key = `table:${match[2]}`;
      creates.set(key, [...(creates.get(key) ?? []), { migration: name, guarded: Boolean(match[1]) }]);
    }
    for (const match of body.matchAll(/CREATE\s+(?:UNIQUE\s+)?INDEX\s+(IF NOT EXISTS\s+)?"([^"]+)"/gi)) {
      const key = `index:${match[2]}`;
      creates.set(key, [...(creates.get(key) ?? []), { migration: name, guarded: Boolean(match[1]) }]);
    }
    for (const match of body.matchAll(/ALTER TABLE\s+"([^"]+)"\s+([\s\S]*?);/gi)) {
      const table = match[1];
      for (const col of match[2].matchAll(/ADD COLUMN\s+(IF NOT EXISTS\s+)?"([^"]+)"/gi)) {
        const key = `column:${table}.${col[2]}`;
        adds.set(key, [...(adds.get(key) ?? []), { migration: name, guarded: Boolean(col[1]) }]);
      }
    }
  }
  return { creates, adds };
}

/** A duplicate is only a replay hazard if the *later* statement is unguarded —
 *  the first one always runs against a database that does not have the object
 *  yet. */
function unguardedDuplicates(entries: Map<string, Statement[]>): string[] {
  const problems: string[] = [];
  for (const [key, statements] of entries) {
    if (statements.length < 2) continue;
    const later = statements.slice(1).filter((statement) => !statement.guarded);
    if (later.length === 0) continue;
    problems.push(
      `${key} is created by ${statements.length} migrations and ${later
        .map((statement) => statement.migration)
        .join(", ")} do not guard with IF NOT EXISTS`,
    );
  }
  return problems.sort();
}

describe("prisma migration chain", () => {
  const { creates, adds } = collect();

  it("has migrations to check", () => {
    expect(migrationFiles().length).toBeGreaterThan(0);
  });

  it("never creates the same table or index twice without IF NOT EXISTS", () => {
    expect(unguardedDuplicates(creates)).toEqual([]);
  });

  it("never adds the same column twice without IF NOT EXISTS", () => {
    expect(unguardedDuplicates(adds)).toEqual([]);
  });

  it("keeps the known-diverged migration idempotent", () => {
    // Pinning the specific regression: if someone regenerates this migration
    // from a fresh introspection, the guards vanish and replay breaks again.
    const sql = readFileSync(
      join(MIGRATIONS_DIR, "20260705010000_workspace_operating_model", "migration.sql"),
      "utf8",
    );
    for (const table of ["tasks", "documents", "org_charts", "installed_modules", "custom_modules"]) {
      expect(sql).toContain(`CREATE TABLE IF NOT EXISTS "${table}"`);
    }
    expect(sql).toContain(`ALTER TABLE "agents" ADD COLUMN IF NOT EXISTS "description"`);
  });
});
