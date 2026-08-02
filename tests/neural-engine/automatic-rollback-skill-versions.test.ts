import { afterAll, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { createFeatureFlag } from "@/lib/learning/feature-flags";
import {
  activateSkillVersion,
  createSkillVersion,
  listSkillVersions,
} from "@/lib/learning/skill-versions";
import {
  monitorAndAutoRollback,
  proposeCandidate,
} from "@/lib/neural-engine/learning-service";
import { makeAgent, makeKnowledgeObject, uid } from "./db-setup";

afterAll(async () => {
  await db.$disconnect();
});

describe("Learning Core — automatic rollback wiring", () => {
  it("disables rollout, reverses the candidate, and records governance evidence atomically", async () => {
    const agent = await makeAgent("Automatic Rollback Agent");
    const object = await makeKnowledgeObject({ title: "Automatic rollback target" });
    const proposedPayload = {
      agentId: agent.id,
      knowledgeObjectId: object.id,
      outcome: "success" as const,
      magnitude: 0.2,
      trustDomain: "retrieval",
    };
    const { candidate } = await proposeCandidate({
      type: "confidence_update",
      proposedPayload,
      evidenceCount: 3,
      confidence: 0.8,
    });
    const flag = await createFeatureFlag({
      key: uid("rollback-flag"),
      name: "Candidate rollout",
      enabled: true,
      rolloutPercentage: 100,
      learningCandidateId: candidate.id,
    });

    await monitorAndAutoRollback(candidate.id, 0.1, 0.3);

    const [storedCandidate, storedFlag, trustEvent, audit, learningEvent, reflection] =
      await Promise.all([
        db.learningCandidate.findUniqueOrThrow({ where: { id: candidate.id } }),
        db.featureFlag.findUniqueOrThrow({ where: { id: flag.id } }),
        db.trustEvent.findFirstOrThrow({
          where: { candidateId: candidate.id, eventType: "candidate_failed_or_rolled_back" },
        }),
        db.auditLog.findFirstOrThrow({
          where: {
            entityId: candidate.id,
            action: "learning_candidate.automatic_rollback",
          },
        }),
        db.learningEvent.findFirstOrThrow({
          where: {
            sourceId: candidate.id,
            eventType: "rollback_triggered",
          },
        }),
        db.reflection.findFirstOrThrow({
          where: {
            agentId: agent.id,
            reflectionType: "automatic",
            summary: { contains: candidate.id },
          },
        }),
      ]);

    expect(storedCandidate.status).toBe("rolled_back");
    expect(storedFlag.enabled).toBe(false);
    expect(trustEvent.domain).toBe("retrieval");
    expect(trustEvent.delta).toBe(-4);
    expect(audit.actorType).toBe("system");
    expect(learningEvent.severity).toBe("warning");
    expect(reflection.whatFailed).toContain("fell below rollback threshold");

    await expect(proposeCandidate({
      type: "confidence_update",
      proposedPayload,
      evidenceCount: 3,
      confidence: 0.8,
    })).rejects.toThrow("materially change the proposal");

    const changed = await proposeCandidate({
      type: "confidence_update",
      proposedPayload: { ...proposedPayload, magnitude: 0.25 },
      evidenceCount: 3,
      confidence: 0.8,
    });
    expect(changed.candidate.status).toBe("auto_approved");
  });
});

describe("Learning Core — skill version history", () => {
  it("drafts governed changes and retires the prior active version on activation", async () => {
    const skill = await db.skill.create({
      data: {
        name: uid("versioned-skill"),
        description: "Skill version integration fixture",
        domain: "testing",
        status: "active",
      },
    });

    const first = await createSkillVersion(skill.id, {
      implementationType: "json",
      implementation: { step: "baseline" },
      inputSchema: { type: "object" },
      permissions: ["read"],
      approvalLevel: 3,
    });
    expect(first.version).toBe(1);
    expect(first.status).toBe("active");

    const governed = await createSkillVersion(skill.id, {
      implementationType: "json",
      implementation: { step: "governed-change" },
      outputSchema: { type: "string" },
      permissions: ["read", "write"],
      approvalLevel: 2,
    });
    expect(governed.version).toBe(2);
    expect(governed.status).toBe("draft");
    expect((await db.skill.findUniqueOrThrow({ where: { id: skill.id } })).version).toBe(1);

    await activateSkillVersion(governed.id);
    const [retiredFirst, activeSecond, parent] = await Promise.all([
      db.skillVersion.findUniqueOrThrow({ where: { id: first.id } }),
      db.skillVersion.findUniqueOrThrow({ where: { id: governed.id } }),
      db.skill.findUniqueOrThrow({ where: { id: skill.id } }),
    ]);
    expect(retiredFirst.status).toBe("retired");
    expect(retiredFirst.retiredAt).not.toBeNull();
    expect(activeSecond.status).toBe("active");
    expect(activeSecond.activatedAt).not.toBeNull();
    expect(parent.version).toBe(2);
    expect(parent.outputSchema).toEqual({ type: "string" });
    expect(parent.permissions).toEqual(["read", "write"]);

    const lowRisk = await createSkillVersion(skill.id, {
      implementationType: "json",
      implementation: { step: "low-risk-change" },
      approvalLevel: 1,
    });
    expect(lowRisk.status).toBe("active");
    expect((await db.skillVersion.findUniqueOrThrow({ where: { id: governed.id } })).status)
      .toBe("retired");
    expect((await listSkillVersions(skill.id)).map((version) => version.version))
      .toEqual([3, 2, 1]);
  });
});
