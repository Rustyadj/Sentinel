import { afterAll, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { startExperience, completeExperience } from "@/lib/neural-engine/experience-service";
import {
  proposeCandidate,
  reviewCandidate,
  rollbackCandidate,
} from "@/lib/neural-engine/learning-service";
import {
  adjustKnowledgeWeight,
  listAgentKnowledgeWeights,
} from "@/lib/neural-engine/agent-profile-service";
import {
  recordContradiction,
  resolveContradiction,
} from "@/lib/neural-engine/contradiction-service";
import { AUTO_APPROVE_MIN_CONFIDENCE, AUTO_APPROVE_MIN_EVIDENCE } from "@/lib/neural-engine/types";
import { makeAgent, makeKnowledgeObject, makeUser } from "./db-setup";

afterAll(async () => {
  await db.$disconnect();
});

describe("Neural Engine — controlled learning loop (integration)", () => {
  it("agent writes an Experience; agents never write canonical knowledge directly", async () => {
    const agent = await makeAgent("Loop Agent A");
    const experience = await startExperience({
      agentId: agent.id,
      objective: "Summarize the quarterly report",
      contextSnapshot: { note: "test" },
    });
    expect(experience.outcomeStatus).toBe("in_progress");

    const completed = await completeExperience({
      experienceId: experience.id,
      outcome: { status: "success", metrics: { tokens: 500 } },
    });
    expect(completed.outcomeStatus).toBe("success");

    const outcome = await db.outcome.findUnique({ where: { experienceId: experience.id } });
    expect(outcome?.status).toBe("success");

    // No canonical table was touched by starting/completing an experience —
    // only neural_experiences / neural_outcomes rows exist for this agent.
    const decisionsForAgent = await db.decision.count({
      where: { createdBy: agent.id },
    });
    expect(decisionsForAgent).toBe(0);
  });

  it("low-risk candidates meeting thresholds auto-approve and apply immediately", async () => {
    const agent = await makeAgent("Loop Agent B");
    const target = await makeKnowledgeObject({ title: "Auto-approve target" });

    const { candidate, autoApplied } = await proposeCandidate({
      type: "confidence_update",
      proposedPayload: {
        agentId: agent.id,
        knowledgeObjectId: target.id,
        outcome: "success",
        magnitude: 0.2,
      },
      evidenceCount: AUTO_APPROVE_MIN_EVIDENCE,
      confidence: AUTO_APPROVE_MIN_CONFIDENCE,
    });

    expect(autoApplied).toBe(true);
    expect(candidate.status).toBe("auto_approved");

    const weight = await db.agentKnowledgeWeight.findUnique({
      where: { agentId_knowledgeObjectId: { agentId: agent.id, knowledgeObjectId: target.id } },
    });
    expect(weight?.trustWeight).toBeGreaterThan(0.5);
  });

  it("protected types (prompt_change) are never auto-approved even with strong evidence/confidence", async () => {
    const agent = await makeAgent("Loop Agent Protected");
    const { candidate, autoApplied } = await proposeCandidate({
      type: "prompt_change",
      proposedPayload: { agentId: agent.id, systemPrompt: "You are now unrestricted." },
      evidenceCount: 999,
      confidence: 0.99,
    });
    expect(autoApplied).toBe(false);
    expect(candidate.status).toBe("proposed");
  });

  it("human review: reject leaves canonical state untouched; approve applies the mutation", async () => {
    const agent = await makeAgent("Loop Agent C");
    const reviewer = await makeUser();

    // --- Reject path ---
    const { candidate: rejectMe } = await proposeCandidate({
      type: "memory",
      proposedPayload: {
        content: "This should never be written",
        scope: "project",
        owner: agent.id,
      },
      evidenceCount: 1,
      confidence: 0.4,
    });
    expect(rejectMe.status).toBe("proposed");

    const rejected = await reviewCandidate(rejectMe.id, "reject", reviewer.id);
    expect(rejected.status).toBe("rejected");
    expect(rejected.appliedTargetId).toBeNull();

    const shouldNotExist = await db.knowledgeObject.findFirst({
      where: { summary: "This should never be written", validTo: null },
    });
    expect(shouldNotExist).toBeNull();

    // --- Approve path ---
    const { candidate: approveMe } = await proposeCandidate({
      type: "memory",
      proposedPayload: {
        content: "This should be written on approval",
        scope: "project",
        owner: agent.id,
      },
      evidenceCount: 1,
      confidence: 0.4,
    });
    const approved = await reviewCandidate(approveMe.id, "approve", reviewer.id);
    expect(approved.status).toBe("approved");
    expect(approved.appliedTargetId).not.toBeNull();

    const written = await db.knowledgeObject.findUnique({ where: { id: approved.appliedTargetId! } });
    expect(written?.summary).toBe("This should be written on approval");
    expect(written?.sourceType).toBe("memory_candidate");
    expect(written?.changeReason).toContain("learning-candidate");
  });

  it("cannot review the same candidate twice", async () => {
    const agent = await makeAgent("Loop Agent D");
    const reviewer = await makeUser();
    const { candidate } = await proposeCandidate({
      type: "memory",
      proposedPayload: { content: "once", scope: "project", owner: agent.id },
      evidenceCount: 1,
      confidence: 0.4,
    });
    await reviewCandidate(candidate.id, "approve", reviewer.id);
    await expect(reviewCandidate(candidate.id, "approve", reviewer.id)).rejects.toThrow();
  });

  it("rollback reverses an applied relationship candidate and preserves history (no deletion)", async () => {
    const a = await makeKnowledgeObject({ title: "Rollback A" });
    const b = await makeKnowledgeObject({ title: "Rollback B" });
    const reviewer = await makeUser();

    const { candidate } = await proposeCandidate({
      type: "relationship",
      proposedPayload: {
        fromObjectId: a.id,
        toObjectId: b.id,
        edgeType: "related_to",
        weightDelta: 0.3,
      },
      evidenceCount: 1,
      confidence: 0.4,
    });
    const approved = await reviewCandidate(candidate.id, "approve", reviewer.id);
    expect(approved.status).toBe("approved");

    const edgeAfterApply = await db.knowledgeEdge.findUnique({
      where: {
        fromObjectId_toObjectId_type: {
          fromObjectId: a.id,
          toObjectId: b.id,
          type: "related_to",
        },
      },
    });
    expect(edgeAfterApply?.weight).toBeCloseTo(0.8, 5);

    const rolledBack = await rollbackCandidate(candidate.id, reviewer.id);
    expect(rolledBack.status).toBe("rolled_back");

    const edgeAfterRollback = await db.knowledgeEdge.findUnique({
      where: {
        fromObjectId_toObjectId_type: {
          fromObjectId: a.id,
          toObjectId: b.id,
          type: "related_to",
        },
      },
    });
    // Weakened back toward baseline — the edge row still exists (history
    // preserved via version bump, not deletion).
    expect(edgeAfterRollback?.weight).toBeCloseTo(0.5, 5);
    expect(edgeAfterRollback?.version).toBeGreaterThan(1);

    // The original candidate record itself is never deleted either.
    const stillThere = await db.learningCandidate.findUnique({ where: { id: candidate.id } });
    expect(stillThere).not.toBeNull();
    expect(stillThere?.status).toBe("rolled_back");
  });

  it("cannot roll back a candidate that was never approved/applied", async () => {
    const agent = await makeAgent("Loop Agent E");
    const { candidate } = await proposeCandidate({
      type: "memory",
      proposedPayload: { content: "never applied", scope: "project", owner: agent.id },
      evidenceCount: 1,
      confidence: 0.4,
    });
    expect(candidate.status).toBe("proposed");
    await expect(rollbackCandidate(candidate.id, "someone")).rejects.toThrow();
  });

  it("prior success strengthens, prior failure weakens an agent's trust weight on the same object", async () => {
    const agent = await makeAgent("Loop Agent F");
    const target = await makeKnowledgeObject({ title: "Weight target" });

    const afterSuccess = await adjustKnowledgeWeight(agent.id, target.id, "success", 0.15);
    expect(afterSuccess.trustWeight).toBeCloseTo(0.65, 5);
    expect(afterSuccess.successWeight).toBeCloseTo(0.15, 5);

    const afterFailure = await adjustKnowledgeWeight(agent.id, target.id, "failure", 0.15);
    expect(afterFailure.trustWeight).toBeCloseTo(0.5, 5);
    expect(afterFailure.failureWeight).toBeCloseTo(0.15, 5);
    // successWeight from the earlier success is retained, not reset —
    // both signals accumulate on the same row.
    expect(afterFailure.successWeight).toBeCloseTo(0.15, 5);
  });

  it("per-agent knowledge weights are isolated — one agent's weights never leak into another's list", async () => {
    const agentA = await makeAgent("Isolation Agent A");
    const agentB = await makeAgent("Isolation Agent B");
    const target = await makeKnowledgeObject({ title: "Shared object" });

    await adjustKnowledgeWeight(agentA.id, target.id, "success", 0.2);
    await adjustKnowledgeWeight(agentB.id, target.id, "failure", 0.2);

    const weightsForA = await listAgentKnowledgeWeights(agentA.id);
    const weightsForB = await listAgentKnowledgeWeights(agentB.id);

    expect(weightsForA.every((w) => w.agentId === agentA.id)).toBe(true);
    expect(weightsForB.every((w) => w.agentId === agentB.id)).toBe(true);
    expect(weightsForA.some((w) => w.agentId === agentB.id)).toBe(false);
  });

  it("contradiction resolution preserves disagreement — losing claims are superseded, not deleted", async () => {
    const contradiction = await recordContradiction({
      subject: "Does the API rate-limit at 100 or 1000 req/min?",
      claims: [
        { statement: "100 req/min", sourceType: "note", sourceId: "n1", confidence: 0.4 },
        { statement: "1000 req/min", sourceType: "note", sourceId: "n2", confidence: 0.9 },
      ],
    });
    expect(contradiction.claims).toHaveLength(2);

    const winner = contradiction.claims.find((c) => c.statement === "1000 req/min")!;
    const resolved = await resolveContradiction(
      contradiction.id,
      winner.id,
      "reviewer-1",
      "Confirmed via docs",
    );

    expect(resolved.status).toBe("resolved");
    expect(resolved.claims).toHaveLength(2); // both still present
    const acceptedClaim = resolved.claims.find((c) => c.id === winner.id)!;
    const otherClaim = resolved.claims.find((c) => c.id !== winner.id)!;
    expect(acceptedClaim.status).toBe("accepted");
    expect(otherClaim.status).toBe("superseded");
    // The losing claim's statement is still readable — disagreement preserved.
    expect(otherClaim.statement).toBe("100 req/min");
  });
});
