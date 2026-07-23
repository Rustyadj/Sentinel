import { afterAll, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { scanForPromotableSkills } from "@/lib/neural-engine/skill-promotion-service";
import {
  MIN_PROMOTION_DISTINCT_TASKS,
  MIN_PROMOTION_EVIDENCE_COUNT,
} from "@/lib/neural-engine/skill-service";
import { makeAgent } from "./db-setup";

afterAll(async () => {
  await db.$disconnect();
});

const STRONG_TASK_COUNT = Math.max(MIN_PROMOTION_DISTINCT_TASKS, MIN_PROMOTION_EVIDENCE_COUNT);

async function makeStrongExperience(agentId: string, objective: string, taskId: string) {
  const exp = await db.experience.create({
    data: { agentId, objective, taskId, outcomeStatus: "success" },
  });
  await db.evaluation.create({
    data: { experienceId: exp.id, confidence: 0.9, safetyScore: 1 },
  });
  return exp;
}

describe("skill-promotion-service — never bypasses the human-review gate", () => {
  it("proposes a `skill` LearningCandidate (never a Skill directly) once real evidence clears every threshold", async () => {
    const agent = await makeAgent("Promotion Agent A");
    const objective = `promotion-fixture-strong-evidence-${Date.now()}`;
    for (let i = 0; i < STRONG_TASK_COUNT; i++) {
      await makeStrongExperience(agent.id, objective, `task-${agent.id}-${i}`);
    }

    const result = await scanForPromotableSkills(agent.id);
    expect(result.proposed.length).toBe(1);

    const candidate = await db.learningCandidate.findUniqueOrThrow({
      where: { id: result.proposed[0] },
    });
    expect(candidate.type).toBe("skill");
    // Proposed, not applied — skill/procedure are never on the auto-approve
    // allowlist, so this must wait for a human even with perfect evidence.
    expect(candidate.status).toBe("proposed");
    expect(candidate.appliedTargetId).toBeNull();

    const skillsCreated = await db.skill.count({ where: { owner: agent.id } });
    expect(skillsCreated).toBe(0);
  });

  it("skips a domain group with insufficient evidence (no one-off promotion)", async () => {
    const agent = await makeAgent("Promotion Agent B");
    const objective = `promotion-fixture-one-off-${Date.now()}`;
    await makeStrongExperience(agent.id, objective, `task-${agent.id}-only`);

    const result = await scanForPromotableSkills(agent.id);
    expect(result.proposed).toHaveLength(0);
    expect(result.skippedIneligible).toBeGreaterThanOrEqual(1);
  });

  it("does not re-propose a domain that already has a pending proposal", async () => {
    const agent = await makeAgent("Promotion Agent C");
    const objective = `promotion-fixture-dedupe-${Date.now()}`;
    for (let i = 0; i < STRONG_TASK_COUNT; i++) {
      await makeStrongExperience(agent.id, objective, `task-${agent.id}-dedupe-${i}`);
    }

    const first = await scanForPromotableSkills(agent.id);
    expect(first.proposed).toHaveLength(1);

    const second = await scanForPromotableSkills(agent.id);
    expect(second.proposed).toHaveLength(0);
    expect(second.skippedAlreadyCovered).toBeGreaterThanOrEqual(1);
  });

  it("rejects a group with an unresolved safety failure regardless of otherwise-strong evidence", async () => {
    const agent = await makeAgent("Promotion Agent D");
    const objective = `promotion-fixture-unsafe-${Date.now()}`;
    for (let i = 0; i < STRONG_TASK_COUNT; i++) {
      await makeStrongExperience(agent.id, objective, `task-${agent.id}-unsafe-${i}`);
    }
    const unsafeExp = await db.experience.create({
      data: { agentId: agent.id, objective, taskId: `task-${agent.id}-unsafe-bad`, outcomeStatus: "success" },
    });
    await db.evaluation.create({
      data: { experienceId: unsafeExp.id, confidence: 0.9, safetyScore: 0.1 },
    });

    const result = await scanForPromotableSkills(agent.id);
    expect(result.proposed).toHaveLength(0);
    expect(result.skippedIneligible).toBeGreaterThanOrEqual(1);
  });
});
