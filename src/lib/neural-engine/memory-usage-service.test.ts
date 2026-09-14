import { afterAll, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { recordMemoryRetrieval, syncProvenanceTrust } from "./memory-usage-service";
import { classifyExistingSource, isDerived, provenanceTrustFor } from "./memory-provenance";
import { excludeFromRetrieval } from "@/lib/learning/memory-governance";

afterAll(async () => db.$disconnect());

async function makeMemory(overrides: Record<string, unknown> = {}) {
  return db.memory.create({
    data: {
      type: "fact",
      scope: "global",
      owner: `usage-test-${Date.now()}-${Math.random()}`,
      content: "a durable memory",
      source: "chat",
      ...overrides,
    },
  });
}

describe("memory provenance", () => {
  it("keeps observed and user-provided knowledge distinguishable from derived", () => {
    expect(isDerived("OBSERVED")).toBe(false);
    expect(isDerived("USER_PROVIDED")).toBe(false);
    expect(isDerived("GENERALIZED")).toBe(true);
    expect(isDerived("INFERRED")).toBe(true);
    expect(isDerived("SYSTEM_DERIVED")).toBe(true);
  });

  it("trusts first-hand sources above anything the system derived", () => {
    expect(provenanceTrustFor("USER_PROVIDED")).toBeGreaterThan(provenanceTrustFor("OBSERVED"));
    expect(provenanceTrustFor("OBSERVED")).toBeGreaterThan(provenanceTrustFor("INFERRED"));
    expect(provenanceTrustFor("INFERRED")).toBeGreaterThan(provenanceTrustFor("SYSTEM_DERIVED"));
  });

  it("classifies legacy free-text sources without downgrading real history", () => {
    expect(classifyExistingSource("chat")).toBe("OBSERVED");
    expect(classifyExistingSource("user_preference")).toBe("USER_PROVIDED");
    expect(classifyExistingSource("consolidation")).toBe("SYSTEM_DERIVED");
    expect(classifyExistingSource(undefined)).toBe("OBSERVED");
    // An unrecognised legacy value predates derived memory, so it is a capture.
    expect(classifyExistingSource("some-old-importer")).toBe("OBSERVED");
  });
});

describe("recording retrieval", () => {
  it("records the retrieval without claiming the memory was useful", async () => {
    const memory = await makeMemory();

    const recorded = await recordMemoryRetrieval({ memoryIds: [memory.id], userId: "u1" });
    expect(recorded).toBe(1);

    const after = await db.memory.findUniqueOrThrow({ where: { id: memory.id } });
    expect(after.retrievalCount).toBe(1);
    expect(after.lastRetrievedAt).not.toBeNull();
    // The whole point: being fetched is not evidence of usefulness.
    expect(after.lastUsefulAt).toBeNull();
    expect(after.confirmationCount).toBe(0);

    const rows = await db.memoryRetrieval.findMany({ where: { memoryId: memory.id } });
    expect(rows).toHaveLength(1);
    expect(rows[0].resolvedAt).toBeNull();
    expect(rows[0].contributedToOutcome).toBeNull();
  });

  it("deduplicates ids within one retrieval", async () => {
    const memory = await makeMemory();
    await recordMemoryRetrieval({ memoryIds: [memory.id, memory.id, memory.id] });

    const rows = await db.memoryRetrieval.findMany({ where: { memoryId: memory.id } });
    expect(rows).toHaveLength(1);
  });

  it("is a no-op for an empty batch", async () => {
    expect(await recordMemoryRetrieval({ memoryIds: [] })).toBe(0);
  });

  it("never throws when given ids that are not durable memories", async () => {
    // Session turns carry synthetic `session:<room>:<n>` ids and no Memory row.
    // Retrieval must survive that rather than failing the caller's request.
    await expect(recordMemoryRetrieval({ memoryIds: ["session:room-1:0"] })).resolves.toBe(0);
  });

  it("derives provenance trust from the source rather than from retrieval", async () => {
    const memory = await makeMemory({ provenanceClass: "GENERALIZED" });
    await syncProvenanceTrust();

    const after = await db.memory.findUniqueOrThrow({ where: { id: memory.id } });
    expect(after.provenanceTrust).toBeCloseTo(provenanceTrustFor("GENERALIZED"));
  });
});

describe("shadow isolation", () => {
  it("excludes shadow-only memories at the single retrieval choke point", () => {
    expect(excludeFromRetrieval()).toMatchObject({ shadowOnly: false });
  });

  it("keeps generalized shadow memories out of every retrieval branch", async () => {
    const owner = `shadow-${Date.now()}-${Math.random()}`;
    await makeMemory({ owner, provenanceClass: "GENERALIZED", shadowOnly: true, content: "derived pattern" });
    await makeMemory({ owner, content: "observed fact" });

    const visible = await db.memory.findMany({ where: { owner, ...excludeFromRetrieval() } });

    expect(visible.map((m) => m.content)).toEqual(["observed fact"]);
  });
});
