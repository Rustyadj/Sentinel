import { afterAll, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import {
  activateSkillVersion,
  createSkillVersion,
} from "@/lib/learning/skill-versions";
import { rollbackCandidate } from "@/lib/neural-engine/learning-service";
import { makeUser, uid } from "../neural-engine/db-setup";

afterAll(async () => {
  await db.$disconnect();
});

describe("release audit — exact rollback restoration", () => {
  it("restores the prior immutable skill version and parent convenience fields", async () => {
    const reviewer = await makeUser();
    const skill = await db.skill.create({
      data: {
        name: uid("rollback-versioned-skill"),
        description: "Exact rollback restoration fixture",
        domain: "release-audit",
        status: "active",
      },
    });
    const baseline = await createSkillVersion(skill.id, {
      implementationType: "json",
      implementation: { step: "baseline" },
      inputSchema: { type: "object", required: ["baseline"] },
      outputSchema: { type: "string" },
      permissions: ["read"],
      tests: [{ name: "baseline" }],
      approvalLevel: 3,
    }, { authorizedByUserId: reviewer.id });
    const changed = await createSkillVersion(skill.id, {
      implementationType: "json",
      implementation: { step: "regressing-change" },
      inputSchema: { type: "object", required: ["changed"] },
      outputSchema: { type: "number" },
      permissions: ["read", "write"],
      tests: [{ name: "changed" }],
      approvalLevel: 2,
    });
    await activateSkillVersion(changed.id, { authorizedByUserId: reviewer.id });

    const candidate = await db.learningCandidate.create({
      data: {
        type: "skill",
        proposedPayload: {
          skillId: skill.id,
          skillVersionId: changed.id,
          generationPipeline: "safe_skill_generation",
          pipelineStage: "awaiting_approval",
        },
        appliedTargetId: skill.id,
        riskLevel: "medium",
        status: "approved",
        reviewedBy: reviewer.id,
        resolvedAt: new Date(),
      },
    });

    await rollbackCandidate(candidate.id, reviewer.id, "release audit regression");

    const [storedBaseline, storedChanged, storedSkill] = await Promise.all([
      db.skillVersion.findUniqueOrThrow({ where: { id: baseline.id } }),
      db.skillVersion.findUniqueOrThrow({ where: { id: changed.id } }),
      db.skill.findUniqueOrThrow({ where: { id: skill.id } }),
    ]);
    expect(storedChanged.status).toBe("rolled_back");
    expect(storedChanged.retiredAt).not.toBeNull();
    expect(storedBaseline.status).toBe("active");
    expect(storedBaseline.retiredAt).toBeNull();
    expect(storedSkill).toMatchObject({
      version: baseline.version,
      status: "active",
      inputSchema: baseline.inputSchema,
      outputSchema: baseline.outputSchema,
      permissions: baseline.permissions,
      tests: baseline.tests,
    });
  });
});
