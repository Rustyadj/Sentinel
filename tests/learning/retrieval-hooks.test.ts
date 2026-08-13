import { afterAll, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { retrieveForPlanning, retrieveForResponse, retrieveForRiskStage } from "@/lib/learning/retrieval-hooks";
import { retrieveContext } from "@/lib/knowledge/retrieval";
import { forgetMemory } from "@/lib/learning/memory-governance";
import { makeUser, uid } from "../neural-engine/db-setup";

afterAll(async () => {
  await db.$disconnect();
});

describe("Step-specific memory retrieval", () => {
  it("planning stage returns goal/decision/constraint-tagged memories, not tool-policy or formatting preference memories", async () => {
    const owner = uid("owner");
    const goalMemory = await db.memory.create({
      data: { type: "goal", scope: "user", owner, content: "Ship v2 by Friday", tags: ["goal"], source: "test" },
    });
    const formattingMemory = await db.memory.create({
      data: { type: "preference", scope: "user", owner, content: "Always use bullet points", tags: ["formatting", "communication"], source: "test" },
    });

    const planningResult = await retrieveForPlanning({ maxItems: 500 });
    const planningIds = planningResult.memories.map((m) => m.id);
    expect(planningResult.stage).toBe("before_plan");
    // The tag filter is the real assertion — a formatting-preference memory
    // must never surface at the planning stage regardless of ordering/limits.
    expect(planningIds).toContain(goalMemory.id);
    expect(planningIds).not.toContain(formattingMemory.id);
  });

  it("response stage only returns communication/formatting preferences, never goal or risk memories", async () => {
    const owner = uid("owner");
    await db.memory.create({
      data: { type: "preference", scope: "user", owner, content: "Prefer concise answers", tags: ["communication"], source: "test" },
    });
    const result = await retrieveForResponse({});
    for (const m of result.memories) {
      expect(m.type).toBe("preference");
    }
    expect(result.stage).toBe("before_response");
  });

  it("before-deployment hook retrieves deployment-relevant policies and risk memories", async () => {
    await db.policy.create({
      data: { name: `deploy policy ${uid("nonce")}`, domain: "tool_use", description: "x", riskLevel: "high" },
    });
    const result = await retrieveForRiskStage("before_deployment", {});
    expect(result.stage).toBe("before_deployment");
    expect(result.policies).toBeDefined();
  });
});

describe("Governed forgetting is enforced at the real retrieval boundary", () => {
  it("a forgotten memory does not appear in retrieveContext()'s results", async () => {
    const user = await makeUser();
    const memory = await db.memory.create({
      data: { type: "pattern", scope: "user", owner: user.id, content: "should vanish once forgotten", source: "test", projectId: null },
    });

    const before = await retrieveContext({ userId: user.id, maxItems: 50 });
    expect(before.memories.some((m) => m.id === memory.id)).toBe(true);

    await forgetMemory({ memoryId: memory.id, reason: "test" });

    const after = await retrieveContext({ userId: user.id, maxItems: 50 });
    expect(after.memories.some((m) => m.id === memory.id)).toBe(false);
  });
});
