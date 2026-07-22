import { afterAll, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import {
  getKnowledgeObjectAsOf,
  getKnowledgeObjectChain,
  listCurrentKnowledgeObjects,
  listKnowledgeObjectsBetween,
  supersedeKnowledgeObject,
} from "@/lib/neural-engine/temporal-service";
import { makeKnowledgeObject } from "./db-setup";

afterAll(async () => {
  await db.$disconnect();
});

describe("temporal-service — Layer 3 (Temporal Graph)", () => {
  it("supersession closes the old row and opens a new one, never deleting", async () => {
    const original = await makeKnowledgeObject({ title: "v1" });

    const v2 = await supersedeKnowledgeObject(
      original.id,
      { title: "v2" },
      "tester",
      "correction",
    );

    const reloadedOriginal = await db.knowledgeObject.findUniqueOrThrow({
      where: { id: original.id },
    });
    expect(reloadedOriginal.validTo).not.toBeNull();
    expect(reloadedOriginal.supersededByObjectId).toBe(v2.id);
    expect(v2.title).toBe("v2");
    expect(v2.version).toBe(2);
    expect(v2.validTo).toBeNull();

    // Original row still exists — supersession, not deletion.
    const stillExists = await db.knowledgeObject.findUnique({ where: { id: original.id } });
    expect(stillExists).not.toBeNull();
  });

  it("refuses to supersede an already-superseded row (must supersede the successor)", async () => {
    const original = await makeKnowledgeObject({ title: "chain-start" });
    await supersedeKnowledgeObject(original.id, { title: "chain-v2" }, "tester", "r1");
    await expect(
      supersedeKnowledgeObject(original.id, { title: "chain-v3-invalid" }, "tester", "r2"),
    ).rejects.toThrow();
  });

  it("getKnowledgeObjectChain returns the full chain oldest -> newest from any member id", async () => {
    const v1 = await makeKnowledgeObject({ title: "chain-v1" });
    const v2 = await supersedeKnowledgeObject(v1.id, { title: "chain-v2" }, "tester", "r1");
    const v3 = await supersedeKnowledgeObject(v2.id, { title: "chain-v3" }, "tester", "r2");

    const chainFromV1 = await getKnowledgeObjectChain(v1.id);
    const chainFromV3 = await getKnowledgeObjectChain(v3.id);

    expect(chainFromV1.map((r) => r.title)).toEqual(["chain-v1", "chain-v2", "chain-v3"]);
    expect(chainFromV3.map((r) => r.title)).toEqual(["chain-v1", "chain-v2", "chain-v3"]);
  });

  it('reconstructs "at timestamp" state correctly across a supersession', async () => {
    const v1 = await makeKnowledgeObject({ title: "asof-v1" });
    const tBeforeSupersede = new Date();
    await new Promise((r) => setTimeout(r, 10));

    const v2 = await supersedeKnowledgeObject(v1.id, { title: "asof-v2" }, "tester", "r1");
    await new Promise((r) => setTimeout(r, 10));
    const tAfterSupersede = new Date();

    const stateBefore = await getKnowledgeObjectAsOf(v1.id, tBeforeSupersede);
    expect(stateBefore?.title).toBe("asof-v1");

    const stateAfter = await getKnowledgeObjectAsOf(v2.id, tAfterSupersede);
    expect(stateAfter?.title).toBe("asof-v2");
  });

  it('"now" (listCurrentKnowledgeObjects) only returns validTo=null rows', async () => {
    const v1 = await makeKnowledgeObject({ title: "current-check-v1", scope: "global" });
    const v2 = await supersedeKnowledgeObject(
      v1.id,
      { title: "current-check-v2" },
      "tester",
      "r1",
    );

    const current = await listCurrentKnowledgeObjects({ scope: "global" });
    const ids = current.map((r) => r.id);
    expect(ids).toContain(v2.id);
    expect(ids).not.toContain(v1.id);
  });

  it('"between timestamps" includes rows valid at any point in the window', async () => {
    const from = new Date();
    const v1 = await makeKnowledgeObject({ title: "between-v1" });
    await new Promise((r) => setTimeout(r, 10));
    await supersedeKnowledgeObject(v1.id, { title: "between-v2" }, "tester", "r1");
    await new Promise((r) => setTimeout(r, 10));
    const to = new Date();

    const between = await listKnowledgeObjectsBetween(from, to);
    const titles = between.map((r) => r.title);
    expect(titles).toContain("between-v1");
    expect(titles).toContain("between-v2");
  });
});
