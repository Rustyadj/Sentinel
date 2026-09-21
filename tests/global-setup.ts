import { PrismaClient } from "@prisma/client";
import { db } from "../src/lib/db";

// --- Per-run database isolation -------------------------------------------
//
// vitest.config.ts picks a run-specific database name cloned from a prepared
// template (scripts/test/prepare-test-template.sh) and puts it in
// SENTINEL_TEST_EPHEMERAL_URL. This creates it before the suite and drops it
// afterwards, so every run starts from the template's known state and leaves
// nothing behind.
//
// This replaces the previous arrangement -- one long-lived `sentinel_vitest`
// database that nothing ever cleaned, which grew by ~1,900 rows a run and hid
// decay-sweep bugs behind tens of thousands of rows from earlier runs.
//
// Empty SENTINEL_TEST_EPHEMERAL_URL means the operator pinned
// SENTINEL_TEST_DATABASE_URL deliberately; we then leave the database alone.

function databaseName(url: string): string {
  return new URL(url).pathname.replace(/^\//, "");
}

/** A client on the `postgres` maintenance database of the same server. */
function adminClient(url: string): PrismaClient {
  const admin = new URL(url);
  admin.pathname = "/postgres";
  return new PrismaClient({ datasourceUrl: admin.toString() });
}

/** Identifier quoting for a name we generated ourselves; rejects anything else. */
function assertSafeName(name: string): string {
  if (!/^[a-z0-9_]{1,63}$/.test(name)) throw new Error(`Refusing to act on database name "${name}".`);
  if (/hermesos|prod/.test(name)) throw new Error(`Refusing to act on database name "${name}".`);
  return name;
}

async function createRunDatabase(ephemeralUrl: string): Promise<void> {
  const target = assertSafeName(databaseName(ephemeralUrl));
  const templateUrl = process.env.SENTINEL_TEST_TEMPLATE_URL ?? "";
  const template = assertSafeName(databaseName(templateUrl));
  const admin = adminClient(ephemeralUrl);
  try {
    const exists = await admin.$queryRawUnsafe<Array<{ ok: boolean }>>(
      `SELECT true AS ok FROM pg_database WHERE datname = '${template}'`,
    );
    if (exists.length === 0) {
      throw new Error(
        `Test template database "${template}" does not exist. Build it with scripts/test/prepare-test-template.sh.`,
      );
    }
    await admin.$executeRawUnsafe(`DROP DATABASE IF EXISTS "${target}" WITH (FORCE)`);
    await admin.$executeRawUnsafe(`CREATE DATABASE "${target}" TEMPLATE "${template}"`);
  } finally {
    await admin.$disconnect();
  }
}

async function dropRunDatabase(ephemeralUrl: string): Promise<void> {
  const target = assertSafeName(databaseName(ephemeralUrl));
  const admin = adminClient(ephemeralUrl);
  try {
    await admin.$executeRawUnsafe(`DROP DATABASE IF EXISTS "${target}" WITH (FORCE)`);
  } finally {
    await admin.$disconnect();
  }
}

// Several suites (tests/agents/runtime-authorization.test.ts,
// tests/collaboration/lisa-loop.test.ts, tests/release-audit/
// runtime-session-security.test.ts, ...) repoint the well-known static
// runtime rows (runtime-codex, runtime-claude-code, ...) at throwaway
// per-test workspaces to exercise tenant-isolation checks. There is no
// separate test database — vitest and the app share DATABASE_URL — so a
// test that forgets to restore its own mutation permanently breaks that
// runtime for every real user. That's exactly how runtime-codex and
// runtime-claude-code ended up pointed at deleted test workspaces in
// production. This snapshots those rows once before the whole run and
// restores them once after, independent of which test files touch them.
const STATIC_RUNTIME_IDS = ["runtime-codex", "runtime-claude-code", "runtime-openclaw", "runtime-hermes-lisa"];

/**
 * Refuse to run the suite against a database that is not a declared test
 * database. The snapshot/restore below limits the blast radius of the static
 * runtime rows, but it cannot protect every other table a test writes to, and
 * the comment above records what happened when that was the only safeguard.
 * Set SENTINEL_ALLOW_PROD_TESTS=1 to deliberately override.
 */
function assertTestDatabase(): void {
  if (process.env.SENTINEL_ALLOW_PROD_TESTS === "1") return;
  const url = process.env.DATABASE_URL ?? "";
  const database = url.split("/").pop()?.split("?")[0] ?? "";
  if (/test|vitest/i.test(database)) return;
  throw new Error(
    `Refusing to run tests against database "${database || "<unset>"}": the name does not look like a test database. ` +
      `Point SENTINEL_TEST_DATABASE_URL at a throwaway database, or set SENTINEL_ALLOW_PROD_TESTS=1 to override deliberately.`,
  );
}

export default async function setup() {
  assertTestDatabase();
  const ephemeralUrl = process.env.SENTINEL_TEST_EPHEMERAL_URL ?? "";
  if (ephemeralUrl) await createRunDatabase(ephemeralUrl);

  const rows = await db.agentRuntime.findMany({
    where: { id: { in: STATIC_RUNTIME_IDS } },
    select: { id: true, workspaceId: true },
  });
  const original = new Map(rows.map((row) => [row.id, row.workspaceId]));

  return async function teardown() {
    await Promise.all(
      [...original].map(([id, workspaceId]) =>
        db.agentRuntime.update({ where: { id }, data: { workspaceId } }).catch(() => undefined)
      )
    );
    await db.$disconnect();
    if (ephemeralUrl) await dropRunDatabase(ephemeralUrl);
  };
}
