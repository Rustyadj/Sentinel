import { afterAll, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import {
  getKnowledgeObjectAsOf,
  getKnowledgeObjectChain,
  listCurrentKnowledgeObjects,
  listKnowledgeEdgesAsOf,
  listKnowledgeObjectsAsOf,
  listKnowledgeObjectsBetween,
  supersedeKnowledgeObject,
} from "@/lib/neural-engine/temporal-service";
import { makeKnowledgeObject, makeUser } from "./db-setup";

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

  it("listKnowledgeObjectsAsOf reconstructs the whole-graph node set at a past timestamp", async () => {
    // Project-scoped (not user-owned): supersedeKnowledgeObject carries
    // projectId forward across versions, unlike userId (see the comment in
    // temporal-service.ts — userId can't be copied without colliding with
    // the (sourceType, sourceId, userId) unique index).
    const projectId = `asof-project-${Date.now()}`;
    const v1 = await makeKnowledgeObject({ title: "asof-nodes-v1", scope: "project", projectId });
    const tBetween = new Date();
    await new Promise((r) => setTimeout(r, 10));
    await supersedeKnowledgeObject(v1.id, { title: "asof-nodes-v2" }, "tester", "r1");
    await new Promise((r) => setTimeout(r, 10));
    const tAfter = new Date();

    const access = { userId: "nobody", readableProjectIds: [projectId] };
    const atBetween = await listKnowledgeObjectsAsOf(tBetween, access);
    expect(atBetween.map((o) => o.title)).toContain("asof-nodes-v1");
    expect(atBetween.map((o) => o.title)).not.toContain("asof-nodes-v2");

    const atAfter = await listKnowledgeObjectsAsOf(tAfter, access);
    expect(atAfter.map((o) => o.title)).toContain("asof-nodes-v2");
    expect(atAfter.map((o) => o.title)).not.toContain("asof-nodes-v1");
  });

  it("listKnowledgeObjectsAsOf only returns objects the caller can read (own user or readable projects)", async () => {
    const owner = await makeUser();
    const other = await makeUser();
    await db.knowledgeObject.create({
      data: {
        type: "Note",
        title: "asof-access-owned",
        sourceType: "test",
        sourceId: `asof-access-${Date.now()}`,
        scope: "user",
        userId: owner.id,
      },
    });

    const now = new Date();
    const asOwner = await listKnowledgeObjectsAsOf(now, { userId: owner.id, readableProjectIds: [] });
    expect(asOwner.map((o) => o.title)).toContain("asof-access-owned");

    const asOther = await listKnowledgeObjectsAsOf(now, { userId: other.id, readableProjectIds: [] });
    expect(asOther.map((o) => o.title)).not.toContain("asof-access-owned");
  });

  it("listKnowledgeEdgesAsOf only returns edges valid at the timestamp between the given nodes", async () => {
    const a = await makeKnowledgeObject({ title: "edge-asof-a" });
    const b = await makeKnowledgeObject({ title: "edge-asof-b" });
    const tBeforeEdge = new Date();
    await new Promise((r) => setTimeout(r, 10));
    const edge = await db.knowledgeEdge.create({
      data: { fromObjectId: a.id, toObjectId: b.id, type: "related_to", weight: 0.7 },
    });
    await new Promise((r) => setTimeout(r, 10));
    const tAfterEdge = new Date();

    const beforeEdges = await listKnowledgeEdgesAsOf(tBeforeEdge, [a.id, b.id]);
    expect(beforeEdges.map((e) => e.id)).not.toContain(edge.id);

    const afterEdges = await listKnowledgeEdgesAsOf(tAfterEdge, [a.id, b.id]);
    expect(afterEdges.map((e) => e.id)).toContain(edge.id);
  });

  it("listKnowledgeEdgesAsOf returns nothing for an empty node set", async () => {
    expect(await listKnowledgeEdgesAsOf(new Date(), [])).toEqual([]);
  });
});
