import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { findSimilar, storeEmbedding } from "./embedding-store";
import { SUPPORTED_DIMENSIONS, UnsupportedDimensionError, vectorColumnFor } from "./embeddings";

const OWNER = "embed-store-test-user";
const IDS = ["embed-mem-a", "embed-mem-b", "embed-mem-c"];

/** A deterministic unit vector pointing mostly along one axis, so "closest"
 *  is obvious by construction rather than by luck. */
function vectorAlong(axis: number, dimensions: number): number[] {
  return Array.from({ length: dimensions }, (_, i) => (i === axis ? 1 : 0.001));
}

beforeEach(async () => {
  await db.memory.deleteMany({ where: { id: { in: IDS } } });
  for (const id of IDS) {
    await db.memory.create({
      data: { id, type: "fact", scope: "user", owner: OWNER, content: `content ${id}`, source: "test" },
    });
  }
});

afterEach(async () => {
  await db.memory.deleteMany({ where: { id: { in: IDS } } });
});

describe("vectorColumnFor", () => {
  it("maps every supported dimension to its column", () => {
    for (const dimensions of SUPPORTED_DIMENSIONS) {
      expect(vectorColumnFor(dimensions)).toBe(`vector${dimensions}`);
    }
  });

  it("refuses a dimension the schema has no column for", () => {
    // 768 is a perfectly normal embedding width. The point is that supporting
    // it is a migration someone writes on purpose, not a silent truncation.
    expect(() => vectorColumnFor(768)).toThrow(UnsupportedDimensionError);
  });
});

describe("storeEmbedding", () => {
  it("stores a 512-dimensional Voyage vector, which the old vector(1536) column could not hold", async () => {
    await storeEmbedding({
      memoryId: IDS[0],
      provider: "voyage",
      model: "voyage-3-lite",
      dimensions: 512,
      version: 1,
      vector: vectorAlong(0, 512),
    });
    const row = await db.memoryEmbedding.findFirst({ where: { memoryId: IDS[0] } });
    expect(row).toMatchObject({ provider: "voyage", model: "voyage-3-lite", dimensions: 512, version: 1 });
  });

  it("keeps two providers' vectors for the same memory side by side", async () => {
    await storeEmbedding({ memoryId: IDS[0], provider: "voyage", model: "voyage-3", dimensions: 1024, version: 1, vector: vectorAlong(1, 1024) });
    await storeEmbedding({ memoryId: IDS[0], provider: "openai", model: "text-embedding-3-small", dimensions: 1536, version: 1, vector: vectorAlong(1, 1536) });
    const rows = await db.memoryEmbedding.findMany({ where: { memoryId: IDS[0] } });
    // This is the whole point of the table: a provider comparison needs both
    // opinions to exist at once.
    expect(rows.map((row) => row.provider).sort()).toEqual(["openai", "voyage"]);
  });

  it("replaces rather than duplicates when the same model is re-run", async () => {
    const provenance = { provider: "openai", model: "text-embedding-3-small", dimensions: 1536, version: 1 };
    await storeEmbedding({ ...provenance, memoryId: IDS[0], vector: vectorAlong(0, 1536) });
    await storeEmbedding({ ...provenance, memoryId: IDS[0], vector: vectorAlong(5, 1536) });
    expect(await db.memoryEmbedding.count({ where: { memoryId: IDS[0] } })).toBe(1);
  });

  it("refuses a vector whose length contradicts its declared dimensions", async () => {
    await expect(
      storeEmbedding({ memoryId: IDS[0], provider: "openai", model: "x", dimensions: 1536, version: 1, vector: vectorAlong(0, 512) }),
    ).rejects.toThrow(/512-dimensional vector as 1536/);
  });
});

describe("findSimilar", () => {
  const provenance = { provider: "voyage", model: "voyage-3-lite", dimensions: 512, version: 1 };

  beforeEach(async () => {
    await storeEmbedding({ ...provenance, memoryId: IDS[0], vector: vectorAlong(0, 512) });
    await storeEmbedding({ ...provenance, memoryId: IDS[1], vector: vectorAlong(100, 512) });
    await storeEmbedding({ ...provenance, memoryId: IDS[2], vector: vectorAlong(200, 512) });
  });

  it("ranks the nearest vector first", async () => {
    const hits = await findSimilar(vectorAlong(100, 512), provenance, IDS, 3);
    expect(hits[0].memoryId).toBe(IDS[1]);
    expect(hits[0].distance).toBeLessThan(hits[1].distance);
  });

  it("only ranks candidates the caller allowed, so scope cannot be bypassed", async () => {
    // findSimilar has no idea what the user may see; it must never widen the
    // set it was handed.
    const hits = await findSimilar(vectorAlong(100, 512), provenance, [IDS[0], IDS[2]], 5);
    expect(hits.map((hit) => hit.memoryId)).not.toContain(IDS[1]);
  });

  it("never mixes embedding spaces", async () => {
    await storeEmbedding({
      memoryId: IDS[0], provider: "openai", model: "text-embedding-3-small", dimensions: 1536, version: 1,
      vector: vectorAlong(0, 1536),
    });
    const hits = await findSimilar(vectorAlong(0, 512), provenance, IDS, 5);
    // Three voyage rows exist; the openai row must not be one of the results
    // even though it is the same memory, because the distance would be
    // meaningless.
    expect(hits).toHaveLength(3);
  });

  it("returns nothing when there are no candidates", async () => {
    expect(await findSimilar(vectorAlong(0, 512), provenance, [], 5)).toEqual([]);
  });
});
