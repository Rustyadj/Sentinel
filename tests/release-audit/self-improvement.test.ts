import { afterAll, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import {
  detectCoOccurrenceOpportunities,
  proposeRelationshipCandidatesFromCoOccurrence,
  CO_OCCURRENCE_PIPELINE,
} from "@/lib/learning/self-improvement";
import { makeAgent, makeKnowledgeObject, uid } from "../neural-engine/db-setup";

afterAll(async () => {
  await db.$disconnect();
});

async function makeSuccessExperience(agentId: string, knowledgeUsed: string[]) {
  return db.experience.create({
    data: {
      agentId,
      objective: "test objective",
      knowledgeUsed,
      outcomeStatus: "success",
    },
  });
}

describe("release audit — Self-Improvement engine (Phase 9, co-occurrence discovery)", () => {
  it("only surfaces a pair once it has been used together at least MIN_CO_OCCURRENCES times", async () => {
    const agent = await makeAgent("Co-occurrence test agent");
    const objectA = await makeKnowledgeObject({ sourceId: uid("obj") });
    const objectB = await makeKnowledgeObject({ sourceId: uid("obj") });

    // Only two joint uses — below the threshold, must not surface.
    await makeSuccessExperience(agent.id, [objectA.id, objectB.id]);
    await makeSuccessExperience(agent.id, [objectA.id, objectB.id]);

    const belowThreshold = await detectCoOccurrenceOpportunities({ agentId: agent.id });
    expect(belowThreshold.find((o) => o.fromObjectId === objectA.id || o.toObjectId === objectA.id)).toBeUndefined();

    // A third joint use crosses MIN_CO_OCCURRENCES (3).
    await makeSuccessExperience(agent.id, [objectA.id, objectB.id]);
    const atThreshold = await detectCoOccurrenceOpportunities({ agentId: agent.id });
    const found = atThreshold.find(
      (o) =>
        (o.fromObjectId === objectA.id && o.toObjectId === objectB.id) ||
        (o.fromObjectId === objectB.id && o.toObjectId === objectA.id),
    );
    expect(found).toBeTruthy();
    expect(found?.occurrences).toBe(3);
  });

  it("proposes a real, tenant-linked relationship candidate and auto-applies once evidence is strong enough", async () => {
    const agent = await makeAgent("Co-occurrence proposal test agent");
    const objectA = await makeKnowledgeObject({ sourceId: uid("obj") });
    const objectB = await makeKnowledgeObject({ sourceId: uid("obj") });

    // 6 occurrences -> confidence 0.8, clears AUTO_APPROVE_MIN_CONFIDENCE (0.75)
    // and AUTO_APPROVE_MIN_EVIDENCE (3), so this should auto-apply.
    for (let i = 0; i < 6; i++) {
      await makeSuccessExperience(agent.id, [objectA.id, objectB.id]);
    }

    const opportunities = await detectCoOccurrenceOpportunities({ agentId: agent.id });
    const result = await proposeRelationshipCandidatesFromCoOccurrence(opportunities);
    expect(result.proposed).toBeGreaterThanOrEqual(1);
    expect(result.autoApplied).toBeGreaterThanOrEqual(1);

    const candidate = await db.learningCandidate.findFirst({
      where: {
        type: "relationship",
        proposedPayload: { path: ["generationPipeline"], equals: CO_OCCURRENCE_PIPELINE },
        experienceId: { not: null },
        AND: [
          { proposedPayload: { path: ["fromObjectId"], equals: objectA.id } },
        ],
      },
    });
    expect(candidate).toBeTruthy();
    expect(candidate?.status).toBe("auto_approved");
    // Tenant-scoping check: a candidate with no experienceId would be invisible
    // to every workspace-scoped view (improvement queue, candidates list).
    expect(candidate?.experienceId).toBeTruthy();

    const edge = await db.knowledgeEdge.findUnique({
      where: {
        fromObjectId_toObjectId_type: { fromObjectId: objectA.id, toObjectId: objectB.id, type: "related_to" },
      },
    });
    expect(edge).toBeTruthy();
  });

  it("does not re-propose a pair while an earlier candidate for it is still pending", async () => {
    const agent = await makeAgent("Co-occurrence idempotency test agent");
    const objectA = await makeKnowledgeObject({ sourceId: uid("obj") });
    const objectB = await makeKnowledgeObject({ sourceId: uid("obj") });

    // 3 occurrences -> confidence 0.65, below auto-approve threshold, stays "proposed".
    for (let i = 0; i < 3; i++) {
      await makeSuccessExperience(agent.id, [objectA.id, objectB.id]);
    }
    const opportunities = await detectCoOccurrenceOpportunities({ agentId: agent.id });
    const first = await proposeRelationshipCandidatesFromCoOccurrence(opportunities);
    expect(first.proposed).toBe(1);
    expect(first.autoApplied).toBe(0);

    const second = await proposeRelationshipCandidatesFromCoOccurrence(opportunities);
    expect(second.proposed).toBe(0);
    expect(second.skipped).toBe(1);
  });
});
