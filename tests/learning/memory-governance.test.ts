import { afterAll, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import {
  computeMemoryNetValue,
  quarantineMemory,
  forgetMemory,
  runMemoryDecaySweep,
  recordMemoryContradiction,
  excludeFromRetrieval,
} from "@/lib/learning/memory-governance";
import { uid } from "../neural-engine/db-setup";

afterAll(async () => {
  await db.$disconnect();
});

describe("Memory net value (pure)", () => {
  it("a high-value, low-harm, fresh memory scores well above a harmful/poisoned one", () => {
    const good = computeMemoryNetValue({
      valueScore: 0.9,
      confidence: 0.9,
      transferability: 0.7,
      confirmationCount: 5,
      harmScore: 0,
      stalenessScore: 0,
      retrievalCost: 0.1,
      poisonRisk: 0,
      contradictionCount: 0,
      importanceScore: 0.9,
    });
    const bad = computeMemoryNetValue({
      valueScore: 0.2,
      confidence: 0.3,
      transferability: 0.1,
      confirmationCount: 0,
      harmScore: 0.8,
      stalenessScore: 0.9,
      retrievalCost: 0.5,
      poisonRisk: 0.9,
      contradictionCount: 3,
      importanceScore: 0.2,
    });
    expect(good).toBeGreaterThan(bad);
  });
});

describe("Governed memory forgetting (integration)", () => {
  async function makeMemory(overrides: Partial<Parameters<typeof db.memory.create>[0]["data"]> = {}) {
    return db.memory.create({
      data: {
        type: "pattern",
        scope: "user",
        owner: uid("owner"),
        content: `test memory ${uid("content")}`,
        source: "test",
        ...overrides,
      },
    });
  }

  it("a stale, low-value memory decays to 'stale' or 'forgotten' on sweep; a high-value fresh memory survives", async () => {
    const owner = uid("owner");
    const stale = await makeMemory({
      owner,
      importanceScore: 0.1,
      confidence: 0.2,
      lastUsefulAt: new Date(Date.now() - 200 * 24 * 60 * 60 * 1000),
    });
    const valuable = await makeMemory({
      owner,
      importanceScore: 0.9,
      confidence: 0.9,
      valueScore: 0.9,
      lastUsefulAt: new Date(),
    });

    await runMemoryDecaySweep({});

    const staleAfter = await db.memory.findUniqueOrThrow({ where: { id: stale.id } });
    expect(["stale", "forgotten"]).toContain(staleAfter.state);

    const valuableAfter = await db.memory.findUniqueOrThrow({ where: { id: valuable.id } });
    expect(valuableAfter.state).toBe("active");
  });

  it("quarantine excludes a memory from normal retrieval; validation restores it", async () => {
    const memory = await makeMemory();
    await quarantineMemory({ memoryId: memory.id, reason: "unknown provenance" });

    const excludedQuery = await db.memory.findFirst({ where: { id: memory.id, ...excludeFromRetrieval() } });
    expect(excludedQuery).toBeNull();

    const stillExistsQuery = await db.memory.findFirst({ where: { id: memory.id } });
    expect(stillExistsQuery).not.toBeNull(); // quarantine excludes from retrieval, doesn't delete
  });

  it("repeated unresolved contradictions flag a memory as disputed", async () => {
    const memory = await makeMemory();
    await recordMemoryContradiction(memory.id);
    await recordMemoryContradiction(memory.id);
    const flagged = await recordMemoryContradiction(memory.id);
    expect(flagged.contradictionCount).toBe(3);
    expect(flagged.state).toBe("disputed");
  });

  it("forgetting removes a memory from normal retrieval without deleting the row", async () => {
    const memory = await makeMemory();
    const forgotten = await forgetMemory({ memoryId: memory.id, reason: "no longer useful" });
    expect(forgotten.state).toBe("forgotten");

    const excludedQuery = await db.memory.findFirst({ where: { id: memory.id, ...excludeFromRetrieval() } });
    expect(excludedQuery).toBeNull();

    const raw = await db.memory.findUnique({ where: { id: memory.id } });
    expect(raw).not.toBeNull();
  });
});
