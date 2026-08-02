import { afterAll, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import {
  applyLearningCandidate,
  proposeCandidate,
  reviewCandidate,
  rollbackCandidate,
} from "@/lib/neural-engine/learning-service";
import { makeAgent, makeUser, makeWorkspace } from "../neural-engine/db-setup";

afterAll(async () => {
  await db.$disconnect();
});

async function makeScopedProtectedCandidate(input: {
  type: "prompt_change" | "tool_policy_change";
  payloadExtra: Record<string, unknown>;
}) {
  const owner = await makeUser();
  const workspace = await makeWorkspace(owner.id, "Atomic apply test workspace");
  const agent = await makeAgent("Atomic apply test agent");
  await db.agent.update({ where: { id: agent.id }, data: { workspaceId: workspace.id } });
  const experience = await db.experience.create({
    data: { agentId: agent.id, workspaceId: workspace.id, objective: "atomic apply test experience" },
  });
  const proposed = await proposeCandidate({
    experienceId: experience.id,
    type: input.type,
    proposedPayload: { agentId: agent.id, workspaceId: workspace.id, ...input.payloadExtra },
    riskLevel: "high",
  });
  return { owner, workspace, agent, proposed };
}

describe("release audit — atomic apply and exact rollback", () => {
  it("restores the exact prior systemPrompt on rollback, not just a status flip", async () => {
    const { owner, agent, proposed } = await makeScopedProtectedCandidate({
      type: "prompt_change",
      payloadExtra: { systemPrompt: "new prompt text" },
    });
    await db.agent.update({ where: { id: agent.id }, data: { systemPrompt: "original prompt text" } });

    // reviewCandidate() applies internally on approval — no separate apply call.
    const applied = await reviewCandidate(proposed.candidate.id, "approve", owner.id);
    expect(applied.status).toBe("approved");
    expect(applied.appliedTargetId).toBe(agent.id);

    const afterApply = await db.agent.findUniqueOrThrow({ where: { id: agent.id } });
    expect(afterApply.systemPrompt).toBe("new prompt text");

    // The exact prior value must be captured, not just implied by "it was
    // approved" — this is what rollback actually reads.
    const artifact = await db.learningArtifactVersion.findFirst({
      where: { artifactType: "agent_system_prompt", artifactKey: agent.id, candidateId: proposed.candidate.id },
    });
    expect(artifact).not.toBeNull();
    expect((artifact!.content as { value: string }).value).toBe("original prompt text");

    await rollbackCandidate(proposed.candidate.id, owner.id, "test rollback");

    const afterRollback = await db.agent.findUniqueOrThrow({ where: { id: agent.id } });
    expect(afterRollback.systemPrompt).toBe("original prompt text");
  });

  it("restores the exact prior toolPermissions array on rollback", async () => {
    const { owner, agent, proposed } = await makeScopedProtectedCandidate({
      type: "tool_policy_change",
      payloadExtra: { toolPermissions: ["read_file"] },
    });
    await db.agent.update({ where: { id: agent.id }, data: { toolPermissions: ["read_file", "web_search"] } });

    await reviewCandidate(proposed.candidate.id, "approve", owner.id);

    const afterApply = await db.agent.findUniqueOrThrow({ where: { id: agent.id } });
    expect(afterApply.toolPermissions).toEqual(["read_file"]);

    await rollbackCandidate(proposed.candidate.id, owner.id, "test rollback");

    const afterRollback = await db.agent.findUniqueOrThrow({ where: { id: agent.id } });
    expect(afterRollback.toolPermissions).toEqual(["read_file", "web_search"]);
  });

  it("apply refuses to run twice concurrently on the same candidate (advisory lock serializes, second call sees it's already applied)", async () => {
    // Built directly in "approved" state with matching audit evidence,
    // bypassing reviewCandidate (which itself calls applyLearningCandidate
    // on approval — this test needs two genuinely concurrent, otherwise-valid
    // apply() calls racing the SAME not-yet-applied candidate, which
    // reviewCandidate's own auto-apply would prevent from ever being an
    // untouched target for two racers).
    const reviewer = await makeUser();
    const candidate = await db.learningCandidate.create({
      data: {
        type: "memory",
        proposedPayload: { content: "concurrent apply test" },
        riskLevel: "low",
        status: "approved",
        reviewedBy: reviewer.id,
        resolvedAt: new Date(),
      },
    });
    await db.auditLog.create({
      data: {
        userId: reviewer.id,
        actorType: "user",
        action: "learning_candidate.approved",
        entityType: "LearningCandidate",
        entityId: candidate.id,
        details: {},
      },
    });

    const [first, second] = await Promise.allSettled([
      applyLearningCandidate(candidate.id),
      applyLearningCandidate(candidate.id),
    ]);

    // The advisory lock serializes the two calls rather than letting them
    // race on the canonical mutation; exactly one succeeds, the other sees
    // the already-applied target and refuses.
    const outcomes = [first, second];
    const fulfilled = outcomes.filter((o) => o.status === "fulfilled");
    const rejected = outcomes.filter((o) => o.status === "rejected");
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    if (rejected[0].status === "rejected") {
      expect(String(rejected[0].reason)).toMatch(/already applied/i);
    }

    const memoryCount = await db.memory.count({
      where: { source: `neural-engine:learning-candidate:${candidate.id}` },
    });
    expect(memoryCount).toBe(1); // never double-applied
  });
});
