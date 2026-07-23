import { afterAll, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import {
  checkCandidateForDegradation,
  runDegradationSweep,
} from "@/lib/neural-engine/degradation-service";
import { proposeCandidate } from "@/lib/neural-engine/learning-service";
import { makeAgent, makeKnowledgeObject } from "./db-setup";

afterAll(async () => {
  await db.$disconnect();
});

async function makeAppliedConfidenceUpdate(agentId: string, knowledgeObjectId: string) {
  const { candidate } = await proposeCandidate({
    type: "confidence_update",
    proposedPayload: { agentId, knowledgeObjectId, outcome: "success", magnitude: 0.2 },
    evidenceCount: 3,
    confidence: 0.8,
  });
  expect(candidate.status).toBe("auto_approved");
  return candidate;
}

async function backdateExperience(experienceId: string, createdAt: Date) {
  await db.experience.update({ where: { id: experienceId }, data: { createdAt } });
}

async function makeExperienceAt(
  agentId: string,
  knowledgeObjectId: string,
  outcomeStatus: "success" | "failure",
  createdAt: Date,
) {
  const exp = await db.experience.create({
    data: {
      agentId,
      objective: "degradation-fixture",
      knowledgeUsed: [knowledgeObjectId],
      outcomeStatus,
    },
  });
  await backdateExperience(exp.id, createdAt);
  return exp;
}

describe("degradation-service — real confidence for monitorAndAutoRollback", () => {
  it("returns null for candidates that are not applied confidence_update candidates", async () => {
    const agent = await makeAgent("Degradation Agent A");
    const { candidate: proposedOnly } = await proposeCandidate({
      type: "confidence_update",
      proposedPayload: { agentId: agent.id, knowledgeObjectId: "does-not-matter", outcome: "success" },
      evidenceCount: 1,
      confidence: 0.1,
    });
    expect(proposedOnly.status).toBe("proposed");
    expect(await checkCandidateForDegradation(proposedOnly.id)).toBeNull();

    const { candidate: relationship } = await proposeCandidate({
      type: "relationship",
      proposedPayload: { fromObjectId: "a", toObjectId: "b", edgeType: "related_to" },
      evidenceCount: 1,
      confidence: 0.4,
    });
    expect(await checkCandidateForDegradation(relationship.id)).toBeNull();
  });

  it("declines to judge with fewer than 3 post-strengthening observations (neutral, not degraded)", async () => {
    const agent = await makeAgent("Degradation Agent B");
    const object = await makeKnowledgeObject({ title: "Degradation target B" });
    const candidate = await makeAppliedConfidenceUpdate(agent.id, object.id);

    await makeExperienceAt(agent.id, object.id, "failure", new Date());
    await makeExperienceAt(agent.id, object.id, "failure", new Date());

    const check = await checkCandidateForDegradation(candidate.id);
    expect(check?.degraded).toBe(false);
    expect(check?.after.n).toBe(2);
    expect(check?.currentConfidence).toBe(0.5);
  });

  it("detects real degradation when post-strengthening success rate collapses", async () => {
    const agent = await makeAgent("Degradation Agent C");
    const object = await makeKnowledgeObject({ title: "Degradation target C" });
    const candidate = await makeAppliedConfidenceUpdate(agent.id, object.id);

    const resolvedAt = (await db.learningCandidate.findUniqueOrThrow({ where: { id: candidate.id } }))
      .resolvedAt!;
    const before = new Date(resolvedAt.getTime() - 60 * 1000);
    await makeExperienceAt(agent.id, object.id, "success", before);
    await makeExperienceAt(agent.id, object.id, "success", before);

    const after = new Date(resolvedAt.getTime() + 60 * 1000);
    await makeExperienceAt(agent.id, object.id, "failure", after);
    await makeExperienceAt(agent.id, object.id, "failure", after);
    await makeExperienceAt(agent.id, object.id, "failure", after);

    const check = await checkCandidateForDegradation(candidate.id);
    expect(check?.after.n).toBe(3);
    expect(check?.after.successRate).toBe(0);
    expect(check?.degraded).toBe(true);
    expect(check?.currentConfidence).toBeLessThan(0.3);
  });

  it("does not flag degradation when the post-strengthening success rate holds up", async () => {
    const agent = await makeAgent("Degradation Agent D");
    const object = await makeKnowledgeObject({ title: "Degradation target D" });
    const candidate = await makeAppliedConfidenceUpdate(agent.id, object.id);

    const resolvedAt = (await db.learningCandidate.findUniqueOrThrow({ where: { id: candidate.id } }))
      .resolvedAt!;
    const after = new Date(resolvedAt.getTime() + 60 * 1000);
    await makeExperienceAt(agent.id, object.id, "success", after);
    await makeExperienceAt(agent.id, object.id, "success", after);
    await makeExperienceAt(agent.id, object.id, "success", after);

    const check = await checkCandidateForDegradation(candidate.id);
    expect(check?.degraded).toBe(false);
  });

  it("runDegradationSweep rolls back a genuinely degraded candidate and preserves history", async () => {
    const agent = await makeAgent("Degradation Agent E");
    const object = await makeKnowledgeObject({ title: "Degradation target E" });
    const candidate = await makeAppliedConfidenceUpdate(agent.id, object.id);

    const resolvedAt = (await db.learningCandidate.findUniqueOrThrow({ where: { id: candidate.id } }))
      .resolvedAt!;
    const after = new Date(resolvedAt.getTime() + 60 * 1000);
    await makeExperienceAt(agent.id, object.id, "failure", after);
    await makeExperienceAt(agent.id, object.id, "failure", after);
    await makeExperienceAt(agent.id, object.id, "failure", after);

    const result = await runDegradationSweep();
    expect(result.rolledBack).toContain(candidate.id);

    const reloaded = await db.learningCandidate.findUniqueOrThrow({ where: { id: candidate.id } });
    expect(reloaded.status).toBe("rolled_back");
  });
});
