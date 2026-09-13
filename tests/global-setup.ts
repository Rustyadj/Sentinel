import { db } from "../src/lib/db";

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

export default async function setup() {
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
  };
}
