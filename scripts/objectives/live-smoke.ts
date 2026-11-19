/**
 * Live smoke for the objective engine against REAL external lookups (IANA RDAP,
 * public DNS) on a THROWAWAY database. Agent delegation is stubbed: it would
 * dispatch to production runtimes.
 *
 *   DATABASE_URL=postgresql://...throwaway... npx tsx scripts/objectives/live-smoke.ts
 */
import { promises as dns } from "node:dns";
import { db } from "@/lib/db";
import { advanceObjective } from "@/lib/objectives/engine";
import { createObjective } from "@/lib/objectives/service";

async function main() {
  const url = process.env.DATABASE_URL ?? "";
  if (!url || /hermesos|@postgres:5432/.test(url)) throw new Error("Refusing to run without an explicit throwaway DATABASE_URL.");
  const id = `smoke-${Date.now().toString(36)}`;
  await db.user.create({ data: { id, email: `${id}@sentinel.test`, name: id } });
  await db.workspace.create({ data: { id, slug: id, name: "smoke", ownerId: id } });
  try {
    const objective = await createObjective(id, {
      workspaceId: id, autonomyLevel: 1, budgetCents: 0,
      goal: "Create a new business called Titan Marketing",
      domains: ["google.com", `titan-marketing-${Date.now().toString(36)}.com`],
    });
    const status = await advanceObjective(objective.id, {
      fetch: (i, init) => fetch(i, init), resolveMx: (d) => dns.resolveMx(d), resolveTxt: (d) => dns.resolveTxt(d),
      dispatchAgentRun: async () => { throw new Error("agent dispatch stubbed in smoke"); },
      getAgentRun: async () => null,
    });
    const steps = await db.objectiveStep.findMany({ where: { objectiveId: objective.id }, orderBy: { position: "asc" } });
    console.log("objective status:", status);
    for (const s of steps) console.log(`${s.key.padEnd(17)} ${s.status.padEnd(10)} ${s.status === "completed" ? JSON.stringify(s.output).slice(0, 220) : (s.unblockRequest ?? s.blockedReason ?? "").slice(0, 120)}`);
  } finally {
    await db.objective.deleteMany({ where: { workspaceId: id } });
    await db.auditLog.deleteMany({ where: { workspaceId: id } });
    await db.workspace.delete({ where: { id } });
    await db.user.delete({ where: { id } });
    await db.$disconnect();
  }
}

void main().catch((error) => { console.error(error); process.exit(1); });
