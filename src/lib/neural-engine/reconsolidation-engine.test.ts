import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { reconsolidateMemory, reconsolidateScope, explainBeliefChange } from "./reconsolidation-engine";
import { retrieveContext } from "@/lib/knowledge/retrieval";

const OWNER = "recon-test-user";
const PROJECT = "recon-test-project";
const DAY = 86_400_000;

const IDS = {
  providerA: "recon-provider-a",
  providerB: "recon-provider-b",
  cacheA: "recon-cache-a",
  cacheB: "recon-cache-b",
  global: "recon-global-tz",
};

async function cleanup() {
  await db.memoryReconsolidation.deleteMany({ where: { memoryId: { in: Object.values(IDS) } } });
  await db.memory.deleteMany({ where: { owner: OWNER } });
  await db.project.deleteMany({ where: { id: PROJECT } });
  await db.user.deleteMany({ where: { id: OWNER } });
}

function memory(id: string, content: string, ageDays: number, extra: Record<string, unknown> = {}) {
  const at = new Date(Date.now() - ageDays * DAY);
  return {
    id, content, owner: OWNER, type: "semantic", scope: "project", projectId: PROJECT,
    source: "user", tags: [] as string[], confidence: 0.9, createdAt: at, updatedAt: at,
    validFrom: at, ...extra,
  };
}

beforeEach(async () => {
  await cleanup();
  await db.user.create({ data: { id: OWNER, email: "recon@sentinel.test", name: "Recon" } });
  await db.project.create({ data: { id: PROJECT, name: "Recon", userId: OWNER } });
  await db.memory.createMany({
    data: [
      memory(IDS.providerA, "The project uses provider-a for embeddings.", 90),
      memory(IDS.providerB, "Correction: the project uses provider-b for embeddings, not provider-a.", 2, {
        tags: ["correction"], confidence: 0.98,
      }),
      memory(IDS.cacheA, "The retrieval cache TTL is 60 seconds.", 12),
      memory(IDS.cacheB, "The retrieval cache TTL is 300 seconds.", 10),
      memory(IDS.global, "Timestamps are stored in UTC.", 30, { scope: "global", projectId: null }),
    ],
  });
});

afterAll(cleanup);

describe("shadow mode", () => {
  it("records what it would do without changing any memory", async () => {
    const summary = await reconsolidateMemory(IDS.providerB, { mode: "shadow" });
    expect(summary.mode).toBe("shadow");
    expect(summary.applied).toBe(0);

    const old = await db.memory.findUniqueOrThrow({ where: { id: IDS.providerA } });
    expect(old.validTo).toBeNull();
    expect(old.supersededById).toBeNull();

    const decision = await db.memoryReconsolidation.findFirstOrThrow({
      where: { memoryId: IDS.providerA, relatedMemoryId: IDS.providerB },
    });
    expect(decision.action).toBe("SUPERSEDE");
    expect(decision.shadow).toBe(true);
    expect(decision.applied).toBe(false);
  });
});

describe("apply mode", () => {
  it("closes the superseded belief without deleting it, and links the replacement", async () => {
    await reconsolidateMemory(IDS.providerB, { mode: "apply" });

    const old = await db.memory.findUniqueOrThrow({ where: { id: IDS.providerA } });
    expect(old.validTo).not.toBeNull();
    expect(old.supersededById).toBe(IDS.providerB);
    expect(old.changeReason).toContain("provider-a");
    // The historical record survives verbatim.
    expect(old.content).toBe("The project uses provider-a for embeddings.");
  });

  it("is idempotent — a second run adds no second decision", async () => {
    await reconsolidateMemory(IDS.providerB, { mode: "apply" });
    const first = await db.memoryReconsolidation.count({ where: { memoryId: IDS.providerA } });
    await reconsolidateMemory(IDS.providerB, { mode: "apply" });
    expect(await db.memoryReconsolidation.count({ where: { memoryId: IDS.providerA } })).toBe(first);
  });

  it("records an unresolved conflict instead of picking a winner", async () => {
    await reconsolidateScope({ owner: OWNER }, { mode: "apply" });

    const decision = await db.memoryReconsolidation.findFirstOrThrow({
      where: { memoryId: IDS.cacheA, relatedMemoryId: IDS.cacheB },
    });
    expect(decision.opensContradiction).toBe(true);
    expect(decision.action).toBe("NO_CHANGE");

    // Both remain live.
    for (const id of [IDS.cacheA, IDS.cacheB]) {
      const row = await db.memory.findUniqueOrThrow({ where: { id } });
      expect(row.validTo, id).toBeNull();
    }
  });

  it("never lets a project memory supersede a global one", async () => {
    await reconsolidateScope({ owner: OWNER }, { mode: "apply" });
    const global = await db.memory.findUniqueOrThrow({ where: { id: IDS.global } });
    expect(global.validTo).toBeNull();
    expect(global.supersededById).toBeNull();
  });
});

describe("retrieval after reconsolidation", () => {
  beforeEach(async () => {
    await reconsolidateScope({ owner: OWNER }, { mode: "apply" });
  });

  it("answers a current question with the current belief only", async () => {
    const result = await retrieveContext({
      userId: OWNER, projectId: PROJECT, query: "Which provider does the project use for embeddings?",
      scopePolicy: "user-context",
    });
    const ids = result.memories.map((memory) => memory.id);
    expect(ids).toContain(IDS.providerB);
    expect(ids).not.toContain(IDS.providerA);
  });

  it("answers a historical question with the belief that was replaced", async () => {
    const result = await retrieveContext({
      userId: OWNER, projectId: PROJECT,
      query: "Which embeddings provider were we using before the switch?",
      scopePolicy: "user-context",
    });
    expect(result.memories.map((memory) => memory.id)).toContain(IDS.providerA);
  });

  it("still returns both sides of an unresolved contradiction", async () => {
    const result = await retrieveContext({
      userId: OWNER, projectId: PROJECT, query: "What is the retrieval cache TTL?",
      scopePolicy: "user-context",
    });
    const ids = result.memories.map((memory) => memory.id);
    expect(ids).toContain(IDS.cacheA);
    expect(ids).toContain(IDS.cacheB);
  });
});

describe("explainBeliefChange", () => {
  it("answers why the belief changed, what replaced it, and on what evidence", async () => {
    await reconsolidateMemory(IDS.providerB, { mode: "apply" });
    const explanation = await explainBeliefChange(IDS.providerA);

    expect(explanation?.replacedBy?.id).toBe(IDS.providerB);
    expect(explanation?.decisions[0]?.action).toBe("SUPERSEDE");
    const codes = (explanation?.decisions[0]?.evidence as Array<{ code: string }>).map((item) => item.code);
    expect(codes).toContain("displaces_existing_value");
  });
});
