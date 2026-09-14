import { afterAll, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import {
  getMemoryAsOf,
  getMemoryChain,
  listCurrentMemories,
  listMemoriesAsOf,
  supersedeMemory,
} from "./memory-temporal-service";
import { excludeFromRetrieval } from "@/lib/learning/memory-governance";

afterAll(async () => db.$disconnect());

const uniq = () => `temporal-${Date.now()}-${Math.random().toString(16).slice(2)}`;

async function makeMemory(owner: string, content: string) {
  return db.memory.create({
    data: { type: "fact", scope: "global", owner, content, source: "chat", confirmationCount: 2 },
  });
}

describe("memory supersession", () => {
  it("revises a belief without overwriting what was believed before", async () => {
    const owner = uniq();
    const original = await makeMemory(owner, "the deploy target is port 4860");

    const revised = await supersedeMemory(original.id, { content: "the deploy target is port 4862" }, "verified against the running container");

    const before = await db.memory.findUniqueOrThrow({ where: { id: original.id } });
    expect(before.content).toBe("the deploy target is port 4860"); // verbatim
    expect(before.validTo).not.toBeNull();
    expect(before.supersededById).toBe(revised.id);

    expect(revised.content).toBe("the deploy target is port 4862");
    expect(revised.version).toBe(original.version + 1);
    expect(revised.changeReason).toBe("verified against the running container");
    expect(revised.validTo).toBeNull();
  });

  it("carries accumulated evidence forward rather than resetting it", async () => {
    const owner = uniq();
    const original = await makeMemory(owner, "an established belief");
    const revised = await supersedeMemory(original.id, { content: "a refined belief" }, "new evidence");

    expect(revised.confirmationCount).toBe(original.confirmationCount);
  });

  it("refuses to supersede an already-superseded row", async () => {
    const owner = uniq();
    const original = await makeMemory(owner, "v1");
    await supersedeMemory(original.id, { content: "v2" }, "first revision");

    await expect(supersedeMemory(original.id, { content: "v3" }, "second revision"))
      .rejects.toThrow(/already superseded/);
  });

  it("answers what we believe now and what we believed at a past moment", async () => {
    const owner = uniq();
    const original = await makeMemory(owner, "Lisa listens on 4860");
    const atFirstBelief = new Date();

    await new Promise((resolve) => setTimeout(resolve, 15));
    const revised = await supersedeMemory(original.id, { content: "Lisa listens on 4862" }, "probed the host");

    const now = await listCurrentMemories({ owner });
    expect(now).toHaveLength(1);
    expect(now[0].content).toBe("Lisa listens on 4862");

    const then = await listMemoriesAsOf(atFirstBelief, { owner });
    expect(then).toHaveLength(1);
    expect(then[0].content).toBe("Lisa listens on 4860");

    expect((await getMemoryAsOf(revised.id, atFirstBelief))?.content).toBe("Lisa listens on 4860");
  });

  it("walks the whole chain from any version in it", async () => {
    const owner = uniq();
    const v1 = await makeMemory(owner, "v1");
    const v2 = await supersedeMemory(v1.id, { content: "v2" }, "r1");
    const v3 = await supersedeMemory(v2.id, { content: "v3" }, "r2");

    for (const anyId of [v1.id, v2.id, v3.id]) {
      const chain = await getMemoryChain(anyId);
      expect(chain.map((row) => row.content)).toEqual(["v1", "v2", "v3"]);
    }
  });

  it("keeps superseded versions out of retrieval while leaving them readable", async () => {
    const owner = uniq();
    const original = await makeMemory(owner, "stale belief");
    await supersedeMemory(original.id, { content: "current belief" }, "corrected");

    const retrievable = await db.memory.findMany({ where: { owner, ...excludeFromRetrieval() } });
    expect(retrievable.map((m) => m.content)).toEqual(["current belief"]);

    // Still fully readable through the temporal path — superseded, not deleted.
    expect(await db.memory.findUnique({ where: { id: original.id } })).not.toBeNull();
  });
});
