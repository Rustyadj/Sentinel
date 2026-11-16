// Episode consolidation in ACTIVE mode — what enabling it would actually do.
//
// The learning worker has only ever run consolidation in shadow, and only the
// shadow path was tested. These tests pin down the active path before anyone
// flips SENTINEL_CONSOLIDATION_MODE: what an active generalization looks like,
// that it never crosses a tenant boundary, that re-running stays idempotent,
// and who — if anyone — can retrieve it.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { consolidationMode, runConsolidationCycle } from "@/lib/neural-engine/consolidation-service";
import { excludeFromRetrieval } from "@/lib/learning/memory-governance";
import { buildRetrievalFilters } from "@/lib/knowledge/retrieval";
import { ensureSystemRoles, ensureMemberAccess } from "@/lib/workspaces/permissions-catalog";

const P = `ca-${Date.now().toString(36)}`;
const users = { a: `${P}-user-a`, b: `${P}-user-b` };
const wsA = `${P}-ws-a`;
const wsB = `${P}-ws-b`;
const agent = (tag: string) => `${P}-agent-${tag}`;

async function episode(agentId: string, objective: string, score: number, workspaceId: string | null) {
  return db.experience.create({
    data: {
      agentId, objective, workspaceId, completedAt: new Date(), evaluatorScore: score,
      outcomeStatus: score >= 0.5 ? "success" : "failure",
    },
  });
}

const FAILING = [
  "prisma migration step breaks on the billing schema",
  "billing schema prisma migration step breaking again",
  "breaking prisma migration step billing schema once more",
];

beforeAll(async () => {
  for (const id of Object.values(users)) await db.user.create({ data: { id, email: `${id}@sentinel.test`, name: id } });
  await db.workspace.create({ data: { id: wsA, slug: wsA, name: "CA A", ownerId: users.a } });
  await db.workspace.create({ data: { id: wsB, slug: wsB, name: "CA B", ownerId: users.b } });
  await ensureSystemRoles(wsA);
  await ensureMemberAccess(wsA, users.a);
});

afterAll(async () => {
  await db.memory.deleteMany({ where: { owner: { startsWith: `${P}-agent-` } } });
  await db.experience.deleteMany({ where: { agentId: { startsWith: `${P}-agent-` } } });
  for (const w of [wsA, wsB]) {
    await db.roleAssignment.deleteMany({ where: { workspaceId: w } });
    await db.role.deleteMany({ where: { workspaceId: w } });
    await db.permission.deleteMany({ where: { workspaceId: w } });
  }
  await db.workspace.deleteMany({ where: { id: { in: [wsA, wsB] } } });
  await db.user.deleteMany({ where: { id: { in: Object.values(users) } } });
});

describe("consolidation mode switch", () => {
  it("is shadow unless explicitly active", () => {
    expect(consolidationMode({})).toBe("shadow");
    expect(consolidationMode({ SENTINEL_CONSOLIDATION_MODE: "active" })).toBe("active");
    expect(consolidationMode({ SENTINEL_CONSOLIDATION_MODE: " ACTIVE " })).toBe("active");
    for (const typo of ["on", "true", "activ", "apply", ""]) {
      expect(consolidationMode({ SENTINEL_CONSOLIDATION_MODE: typo }), typo).toBe("shadow");
    }
  });
});

describe("active consolidation cycle", () => {
  it("publishes a generalization that passes the retrieval governance filter", async () => {
    const agentId = agent("publish");
    const episodes = await Promise.all(FAILING.map((o) => episode(agentId, o, 0.1, wsA)));

    const result = await runConsolidationCycle({ mode: "active", agentId });
    expect(result.memoriesGenerated).toBe(1);

    const memory = await db.memory.findFirstOrThrow({ where: { owner: agentId, provenanceClass: "GENERALIZED" } });
    expect(memory.shadowOnly).toBe(false);
    expect(memory.workspaceId).toBe(wsA);
    expect(memory.confidence).toBeLessThanOrEqual(0.85);
    expect([...memory.derivedFromExperienceIds].sort()).toEqual(episodes.map((e) => e.id).sort());
    // Governance no longer hides it: this is exactly what "active" changes.
    expect(await db.memory.count({ where: { id: memory.id, ...excludeFromRetrieval() } })).toBe(1);
  });

  it("never pools episodes from different workspaces into one belief", async () => {
    const agentId = agent("tenants");
    // Two from each workspace: neither tenant alone reaches the 3-episode
    // threshold. Pooled, they would have produced one belief from both.
    await episode(agentId, FAILING[0], 0.1, wsA);
    await episode(agentId, FAILING[1], 0.1, wsA);
    await episode(agentId, FAILING[0], 0.1, wsB);
    await episode(agentId, FAILING[2], 0.1, wsB);

    const result = await runConsolidationCycle({ mode: "active", agentId });
    expect(result.memoriesGenerated).toBe(0);
    expect(await db.memory.count({ where: { owner: agentId } })).toBe(0);
  });

  it("keeps one generalization per workspace when both tenants have enough evidence", async () => {
    const agentId = agent("both");
    for (const ws of [wsA, wsB]) for (const o of FAILING) await episode(agentId, o, 0.15, ws);

    await runConsolidationCycle({ mode: "active", agentId });
    const rows = await db.memory.findMany({ where: { owner: agentId, provenanceClass: "GENERALIZED" } });
    expect(rows.map((r) => r.workspaceId).sort()).toEqual([wsA, wsB].sort());

    // Each belief's evidence comes from its own tenant only.
    for (const row of rows) {
      const sources = await db.experience.findMany({ where: { id: { in: row.derivedFromExperienceIds } }, select: { workspaceId: true } });
      expect(new Set(sources.map((s) => s.workspaceId))).toEqual(new Set([row.workspaceId]));
    }
  });

  it("strengthens rather than duplicates on a second active cycle", async () => {
    const agentId = agent("idempotent");
    for (const o of FAILING) await episode(agentId, o, 0.1, wsA);
    await runConsolidationCycle({ mode: "active", agentId });
    const first = await db.memory.findFirstOrThrow({ where: { owner: agentId } });

    for (const o of FAILING) await episode(agentId, `${o} yet again`, 0.2, wsA);
    await runConsolidationCycle({ mode: "active", agentId });
    const all = await db.memory.findMany({ where: { owner: agentId } });
    expect(all).toHaveLength(1);
    expect(all[0].id).toBe(first.id);
    expect(all[0].confidence).toBeGreaterThan(first.confidence);
  });

  it("never merges a success pattern with a failure pattern", async () => {
    const agentId = agent("direction");
    for (const o of FAILING) await episode(agentId, o, 0.1, wsA);
    for (const o of FAILING) await episode(agentId, o, 0.9, wsA);
    await runConsolidationCycle({ mode: "active", agentId });
    const rows = await db.memory.findMany({ where: { owner: agentId } });
    expect(rows).toHaveLength(2);
    expect(rows.map((r) => r.tags.includes("strength") ? "strength" : "weakness").sort()).toEqual(["strength", "weakness"]);
  });

  it("is not reachable by any user's retrieval filter, inside or outside the workspace", async () => {
    // Generalizations are owned by the agent at scope "global", and global
    // memory is owner-isolated. So even active, no user-context retrieval
    // returns them: enabling consolidation today changes stored data, not
    // what any prompt sees. This test documents that until a reader exists.
    const agentId = agent("reach");
    for (const o of FAILING) await episode(agentId, o, 0.1, wsA);
    await runConsolidationCycle({ mode: "active", agentId });
    // Positive control: the same filter does find real workspace memory, so a
    // zero below means "excluded", not "malformed query".
    const control = await db.memory.create({ data: {
      type: "fact", scope: "workspace", workspaceId: wsA, owner: users.a, source: "test",
      content: "Control: prisma migration billing schema notes.",
    } });

    for (const userId of [users.a, users.b]) {
      const { memory } = buildRetrievalFilters(
        { userId, query: "prisma migration billing schema", workspaceId: wsA, scopePolicy: "user-context" } as never,
        { workspaceIds: userId === users.a ? [wsA] : [], deniedRequestedWorkspace: false },
      );
      const hits = await db.memory.count({ where: { AND: [memory, { owner: agentId }] } });
      expect(hits, userId).toBe(0);
      const controlHits = await db.memory.count({ where: { AND: [memory, { id: control.id }] } });
      expect(controlHits, `control for ${userId}`).toBe(userId === users.a ? 1 : 0);
    }
    await db.memory.delete({ where: { id: control.id } });
  });
});
