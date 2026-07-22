import { afterAll, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { planRetrieval, executeRetrievalPlan, retrieve } from "@/lib/neural-engine/retrieval-planner";
import { adjustKnowledgeWeight } from "@/lib/neural-engine/agent-profile-service";
import { createEdge } from "@/lib/knowledge/edges";
import { makeAgent, makeKnowledgeObject, makeProject, makeUser } from "./db-setup";

afterAll(async () => {
  await db.$disconnect();
});

describe("retrieval-planner — integration (real Postgres)", () => {
  it("planRetrieval enforces the same project isolation as retrieveContext — never candidates another project's objects", async () => {
    const user = await makeUser();
    const projectA = await makeProject(user.id, "Planner Project A");
    const projectB = await makeProject(user.id, "Planner Project B");

    const objA = await makeKnowledgeObject({
      title: "A-only object",
      scope: "project",
      projectId: projectA.id,
    });
    const objB = await makeKnowledgeObject({
      title: "B-only object",
      scope: "project",
      projectId: projectB.id,
    });

    const plan = await planRetrieval({ query: "object", projectId: projectA.id });
    expect(plan.candidateObjectIds).toContain(objA.id);
    expect(plan.candidateObjectIds).not.toContain(objB.id);
  });

  it("explicitObjectIds are always included as candidates even outside the normal cap/order", async () => {
    const explicit = await makeKnowledgeObject({ title: "Forced pick", scope: "global" });
    const plan = await planRetrieval({
      query: "irrelevant text",
      explicitObjectIds: [explicit.id],
    });
    expect(plan.candidateObjectIds).toContain(explicit.id);
  });

  it("explicit selection ranks strictly above everything else, regardless of other factors", async () => {
    const strongMatch = await makeKnowledgeObject({
      title: "deploy pipeline runbook",
      scope: "global",
    });
    const explicitButWeak = await makeKnowledgeObject({
      title: "totally unrelated topic",
      scope: "global",
    });

    const result = await retrieve({
      query: "deploy pipeline",
      explicitObjectIds: [explicitButWeak.id],
      maxItems: 10,
    });

    const explicitItem = result.items.find((i) => i.objectId === explicitButWeak.id)!;
    const matchItem = result.items.find((i) => i.objectId === strongMatch.id);

    expect(explicitItem).toBeDefined();
    if (matchItem) {
      expect(explicitItem.finalScore).toBeGreaterThan(matchItem.finalScore);
    }
    // The explicitly selected item should rank first overall.
    expect(result.items[0].objectId).toBe(explicitButWeak.id);
  });

  it("an agent's prior success on an object raises that object's rank over an otherwise-identical baseline", async () => {
    const agent = await makeAgent("Planner Prior Success Agent");
    const boosted = await makeKnowledgeObject({ title: "shared topic runbook", scope: "global" });
    const baseline = await makeKnowledgeObject({ title: "shared topic runbook", scope: "global" });

    await adjustKnowledgeWeight(agent.id, boosted.id, "success", 0.3);

    const result = await retrieve({
      query: "shared topic runbook",
      agentId: agent.id,
      maxItems: 10,
    });

    const boostedItem = result.items.find((i) => i.objectId === boosted.id)!;
    const baselineItem = result.items.find((i) => i.objectId === baseline.id)!;
    expect(boostedItem.finalScore).toBeGreaterThan(baselineItem.finalScore);
  });

  it("an agent's prior failure on an object lowers its rank versus an otherwise-identical baseline", async () => {
    const agent = await makeAgent("Planner Prior Failure Agent");
    const penalized = await makeKnowledgeObject({ title: "risky topic runbook", scope: "global" });
    const baseline = await makeKnowledgeObject({ title: "risky topic runbook", scope: "global" });

    await adjustKnowledgeWeight(agent.id, penalized.id, "failure", 0.3);

    const result = await retrieve({
      query: "risky topic runbook",
      agentId: agent.id,
      maxItems: 10,
    });

    const penalizedItem = result.items.find((i) => i.objectId === penalized.id)!;
    const baselineItem = result.items.find((i) => i.objectId === baseline.id)!;
    expect(penalizedItem.finalScore).toBeLessThan(baselineItem.finalScore);
  });

  it("graph proximity surfaces a neighbor of an explicit selection with a relationship path in the trace", async () => {
    const hub = await makeKnowledgeObject({ title: "Hub object", scope: "global" });
    const neighbor = await makeKnowledgeObject({ title: "Neighbor object", scope: "global" });
    await createEdge({ fromObjectId: hub.id, toObjectId: neighbor.id, type: "related_to" });

    const result = await retrieve({
      query: "unrelated query text",
      explicitObjectIds: [hub.id],
      maxItems: 20,
    });

    const neighborItem = result.items.find((i) => i.objectId === neighbor.id);
    expect(neighborItem).toBeDefined();
    const proximityFactor = neighborItem!.factors.find((f) => f.factor === "graph_proximity")!;
    expect(proximityFactor.score).toBeGreaterThan(0);
    expect(result.trace.relationshipPaths.length).toBeGreaterThan(0);
  });

  it("the trace never exposes chain-of-thought — only ids, factors, and paths", async () => {
    const obj = await makeKnowledgeObject({ title: "Traced object", scope: "global" });
    const result = await retrieve({ query: "traced object", explicitObjectIds: [obj.id] });

    const traceKeys = Object.keys(result.trace);
    expect(traceKeys).toEqual([
      "requestId",
      "scope",
      "sourceObjectIds",
      "relationshipPaths",
      "rankingFactors",
      "confidence",
    ]);
  });

  it("returns an empty result with zero confidence when there are no candidates", async () => {
    const result = await executeRetrievalPlan({
      request: { query: "nothing" },
      candidateObjectIds: [],
    });
    expect(result.items).toHaveLength(0);
    expect(result.trace.confidence).toBe(0);
  });
});
