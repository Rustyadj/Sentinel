import { afterAll, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { computeMemoryNetValue, runMemoryDecaySweep } from "./memory-governance";
import { JOB_NAMES } from "./queue";
import { retrieveContext } from "@/lib/knowledge/retrieval";

afterAll(async () => db.$disconnect());

const uniq = () => `decay-${Date.now()}-${Math.random().toString(16).slice(2)}`;
const longAgo = new Date(Date.now() - 400 * 24 * 60 * 60 * 1000);

async function makeMemory(owner: string, overrides: Record<string, unknown> = {}) {
  return db.memory.create({
    data: { type: "fact", scope: "global", owner, content: "m", source: "chat", ...overrides },
  });
}

describe("decay is scheduled, not orphaned", () => {
  it("registers the sweep as a real background job", () => {
    // It existed for a long time reachable only through an API route, which
    // meant decay never actually ran.
    expect(JOB_NAMES.memoryDecaySweep).toBe("memory-decay-sweep");
    expect(JOB_NAMES.memoryConsolidation).toBe("memory-consolidation");
  });
});

describe("net value responds to evidence, not only to age", () => {
  it("ranks a useful memory above an equally old unused one", () => {
    const shared = { valueScore: null, transferability: null, harmScore: null, retrievalCost: null, poisonRisk: null, contradictionCount: 0, importanceScore: 0.5, stalenessScore: 0.9 };
    const useful = computeMemoryNetValue({ ...shared, confidence: 0.9, confirmationCount: 5 });
    const unused = computeMemoryNetValue({ ...shared, confidence: 0.9, confirmationCount: 0 });

    expect(useful).toBeGreaterThan(unused);
  });

  it("penalises unresolved contradictions", () => {
    const shared = { valueScore: null, transferability: null, harmScore: null, retrievalCost: null, poisonRisk: null, importanceScore: 0.5, stalenessScore: 0.2, confidence: 0.8, confirmationCount: 2 };
    expect(computeMemoryNetValue({ ...shared, contradictionCount: 0 }))
      .toBeGreaterThan(computeMemoryNetValue({ ...shared, contradictionCount: 3 }));
  });
});

describe("decay sweep", () => {
  it("lets confirmed, useful knowledge resist decay that noise does not", async () => {
    const owner = uniq();
    const valuable = await makeMemory(owner, {
      content: "hard-won architectural fact",
      importanceScore: 0.95, confidence: 0.95,
      confirmationCount: 8, lastUsefulAt: new Date(),
    });
    const noise = await makeMemory(owner, {
      content: "routine chatter",
      importanceScore: 0.02, confidence: 0.05,
      harmScore: 0.8, poisonRisk: 0.7, retrievalCost: 0.9,
      createdAt: longAgo, updatedAt: longAgo,
    });

    await runMemoryDecaySweep({ limit: 2000 });

    const after = await db.memory.findMany({ where: { owner } });
    const valuableAfter = after.find((m) => m.id === valuable.id)!;
    const noiseAfter = after.find((m) => m.id === noise.id)!;

    expect(valuableAfter.valueScore!).toBeGreaterThan(noiseAfter.valueScore!);
    expect(valuableAfter.state).not.toBe("forgotten");
  });

  it("never deletes what it forgets — the row stays recoverable", async () => {
    const owner = uniq();
    const doomed = await makeMemory(owner, {
      importanceScore: 0.01, confidence: 0.01,
      harmScore: 1, poisonRisk: 1, retrievalCost: 1, contradictionCount: 5,
      createdAt: longAgo, updatedAt: longAgo,
    });

    await runMemoryDecaySweep({ limit: 2000 });

    const row = await db.memory.findUnique({ where: { id: doomed.id } });
    expect(row).not.toBeNull(); // decay changes retrievability, not existence
    expect(row!.state).toBe("forgotten");
  });

  it("never undoes an explicit human pin", async () => {
    const owner = uniq();
    const pinned = await makeMemory(owner, {
      pinned: true, importanceScore: 0.01, confidence: 0.01,
      harmScore: 1, poisonRisk: 1, createdAt: longAgo, updatedAt: longAgo,
    });

    await runMemoryDecaySweep({ limit: 2000 });

    const after = await db.memory.findUniqueOrThrow({ where: { id: pinned.id } });
    expect(after.state).not.toBe("forgotten");
  });
});

describe("decay reaches retrieval", () => {
  it("ranks a decayed memory below a valuable one in the same context", async () => {
    const userId = uniq();
    await makeMemory(userId, { content: "decayed", owner: userId, valueScore: -0.2, importanceScore: 0.9 });
    await makeMemory(userId, { content: "valuable", owner: userId, valueScore: 0.9, importanceScore: 0.1 });

    const result = await retrieveContext({ userId, maxItems: 10 });
    const contents = result.memories.map((m) => m.content);

    // importanceScore alone would have put "decayed" first.
    expect(contents.indexOf("valuable")).toBeLessThan(contents.indexOf("decayed"));
  });
});
