// Sentinel Neural Engine — Learning service (the controlled learning loop)
//
// Owns the LearningCandidate lifecycle: propose -> review -> apply -> rollback.
// This is the ONLY module that writes to canonical tables as a result of
// agent-observed experience. Every mutation is versioned and reversible.
//
// Hard rule enforcement lives in policy-service; this file calls it rather
// than re-implementing risk logic, so there's exactly one place the
// never-auto-approve list can drift.

import { db } from "@/lib/db";
import type { Prisma } from "@prisma/client";
import { canAutoApprove, classifyRiskLevel } from "./policy-service";
import { emitNeuralEvent } from "./event-service";
import { adjustKnowledgeWeight } from "./agent-profile-service";
import { recordContradiction } from "./contradiction-service";
import type { ProposedLearningCandidateInput } from "./types";
import { scanUntrustedContent } from "@/lib/adaptive-memory/security";

function toJson(value: unknown): Prisma.InputJsonValue {
  return (value ?? {}) as Prisma.InputJsonValue;
}

export interface ProposeResult {
  candidate: Awaited<ReturnType<typeof db.learningCandidate.create>>;
  autoApplied: boolean;
}

/**
 * Propose a learning candidate. If it's on the low-risk allowlist AND meets
 * evidence/confidence thresholds, it is applied immediately and marked
 * `auto_approved`. Otherwise it's left `proposed` for human review.
 */
export async function proposeCandidate(
  input: ProposedLearningCandidateInput,
): Promise<ProposeResult> {
  const classification = classifyRiskLevel(input.type, input.riskLevel);
  const evidenceCount = input.evidenceCount ?? 1;
  const confidence = input.confidence ?? 0.5;

  const eligible = canAutoApprove(
    input.type,
    evidenceCount,
    confidence,
    input.riskLevel,
  );

  const candidate = await db.learningCandidate.create({
    data: {
      experienceId: input.experienceId ?? null,
      evaluationId: input.evaluationId ?? null,
      type: input.type,
      proposedPayload: toJson(input.proposedPayload),
      targetType: input.targetType ?? null,
      riskLevel: classification.riskLevel,
      evidenceCount,
      confidence,
      status: eligible ? "auto_approved" : "proposed",
      resolvedAt: eligible ? new Date() : null,
    },
  });

  await emitNeuralEvent({
    type: "learning.proposed",
    payload: {
      candidateId: candidate.id,
      type: candidate.type,
      riskLevel: candidate.riskLevel,
      autoApplied: eligible,
    },
  });

  if (eligible) {
    await applyLearningCandidate(candidate.id);
    return { candidate, autoApplied: true };
  }

  return { candidate, autoApplied: false };
}

/** Human review path. `approve` triggers applyLearningCandidate(); `reject` just closes it out. */
export async function reviewCandidate(
  candidateId: string,
  decision: "approve" | "reject",
  reviewerId: string,
) {
  const candidate = await db.learningCandidate.findUniqueOrThrow({
    where: { id: candidateId },
  });

  if (candidate.status !== "proposed") {
    throw new Error(
      `Learning candidate ${candidateId} is already "${candidate.status}" — cannot review again.`,
    );
  }

  if (decision === "reject") {
    const updated = await db.learningCandidate.update({
      where: { id: candidateId },
      data: { status: "rejected", reviewedBy: reviewerId, resolvedAt: new Date() },
    });
    await emitNeuralEvent({
      type: "learning.rejected",
      payload: { candidateId, reviewerId },
    });
    return updated;
  }

  await db.learningCandidate.update({
    where: { id: candidateId },
    data: { status: "approved", reviewedBy: reviewerId, resolvedAt: new Date() },
  });
  await emitNeuralEvent({
    type: "learning.approved",
    payload: { candidateId, reviewerId },
  });

  return applyLearningCandidate(candidateId);
}

/**
 * Apply an approved/auto_approved candidate's payload to canonical state.
 * Dispatches by `type`. Every branch is a real, additive/versioned write —
 * nothing here silently overwrites without provenance.
 */
export async function applyLearningCandidate(candidateId: string) {
  const candidate = await db.learningCandidate.findUniqueOrThrow({
    where: { id: candidateId },
  });

  if (candidate.status !== "approved" && candidate.status !== "auto_approved") {
    throw new Error(
      `Learning candidate ${candidateId} has status "${candidate.status}" — refusing to apply.`,
    );
  }

  // Defense in depth: protected types can never reach this point already
  // approved via auto-approval (policy-service enforces this at propose
  // time), but re-assert here in case a future caller bypasses proposeCandidate.
  if (candidate.status === "auto_approved") {
    const classification = classifyRiskLevel(
      candidate.type as Parameters<typeof classifyRiskLevel>[0],
    );
    if (!classification.autoApproveEligible) {
      throw new Error(
        `Refusing to auto-apply protected candidate type "${candidate.type}".`,
      );
    }
  }

  const payload = candidate.proposedPayload as Record<string, unknown>;
  let appliedTargetId: string | null = null;

  switch (candidate.type) {
    case "confidence_update": {
      const { agentId, knowledgeObjectId, outcome, magnitude } = payload as {
        agentId: string;
        knowledgeObjectId: string;
        outcome: "success" | "failure";
        magnitude?: number;
      };
      const weight = await adjustKnowledgeWeight(
        agentId,
        knowledgeObjectId,
        outcome,
        magnitude,
      );
      appliedTargetId = weight.id;
      await emitNeuralEvent({
        type: outcome === "success" ? "edge.strengthened" : "edge.weakened",
        payload: { agentId, knowledgeObjectId, candidateId },
      });
      break;
    }

    case "relationship": {
      const { fromObjectId, toObjectId, edgeType, weightDelta } = payload as {
        fromObjectId: string;
        toObjectId: string;
        edgeType: string;
        weightDelta?: number;
      };
      const edge = await strengthenOrCreateEdge(
        fromObjectId,
        toObjectId,
        edgeType,
        weightDelta ?? 0.1,
        candidate.id,
      );
      appliedTargetId = edge.id;
      break;
    }

    case "memory": {
      const content = payload.content as string;
      const findings = scanUntrustedContent(content);
      const admission = await db.memoryCandidate.create({
        data: {
          workspaceId: (payload.workspaceId as string) ?? null,
          projectId: (payload.projectId as string) ?? null,
          userId: (payload.userId as string) ?? null,
          agentId: (payload.agentId as string) ?? null,
          runId: candidate.experienceId,
          candidateType: "lesson",
          content,
          structuredPayload: toJson({ tags: payload.tags ?? [], memoryType: payload.memoryType ?? "pattern" }),
          sourceType: "agent_inference",
          sourceTrust: 0.6,
          confidence: candidate.confidence,
          importance: (payload.importanceScore as number) ?? 0.5,
          risk: candidate.riskLevel === "high" ? 0.9 : candidate.riskLevel === "medium" ? 0.5 : 0.2,
          provenance: toJson({ sourceIds: [candidate.id], evidenceIds: [candidate.evaluationId, candidate.experienceId].filter(Boolean), capturedAt: new Date().toISOString() }),
          proposedBy: (payload.agentId as string) ?? "neural-engine",
          status: findings.length ? "quarantined" : "approved",
          quarantineReasons: findings.map((finding) => finding.code),
          reviewedBy: candidate.reviewedBy,
          resolvedAt: findings.length ? null : new Date(),
        },
      });
      if (findings.length) throw new Error(`Memory candidate quarantined: ${findings.map((finding) => finding.code).join(", ")}`);
      const object = await db.knowledgeObject.create({ data: {
        type: "Memory", title: content.slice(0, 120), summary: content,
        sourceType: "memory_candidate", sourceId: admission.id,
        scope: payload.projectId ? "project" : payload.workspaceId ? "workspace" : payload.userId ? "user" : "agent",
        workspaceId: (payload.workspaceId as string) ?? null, projectId: (payload.projectId as string) ?? null,
        userId: (payload.userId as string) ?? null,
        metadata: toJson({ candidateId: admission.id, provenance: admission.provenance, confidence: candidate.confidence, agentId: payload.agentId ?? null }),
        changeReason: `learning-candidate:${candidate.id}`, changedBy: candidate.reviewedBy,
      }});
      await db.memoryCandidate.update({ where: { id: admission.id }, data: { appliedTargetType: "knowledge_object", appliedTargetId: object.id } });
      appliedTargetId = object.id;
      break;
    }

    case "decision": {
      const decision = await db.decision.create({
        data: {
          title: payload.title as string,
          summary: payload.summary as string,
          status: "approved",
          rationale: (payload.rationale as string) ?? null,
          createdBy: (payload.createdBy as string) ?? "neural-engine",
          approvedBy: (payload.reviewedBy as string) ?? null,
          projectId: (payload.projectId as string) ?? null,
          changeReason: `learning-candidate:${candidate.id}`,
        },
      });
      appliedTargetId = decision.id;
      break;
    }

    case "contradiction": {
      const contradiction = await recordContradiction(
        payload as unknown as Parameters<typeof recordContradiction>[0],
      );
      appliedTargetId = contradiction.id;
      break;
    }

    case "skill":
    case "procedure": {
      // Delegates to skill-service, which enforces promotion thresholds
      // independently — a LearningCandidate approval is necessary but not
      // sufficient; skill-service still checks evidence/success-rate.
      const { promoteFromPayload } = await import("./skill-service");
      const promoted = await promoteFromPayload(
        candidate.type as "skill" | "procedure",
        payload,
      );
      appliedTargetId = promoted?.id ?? null;
      break;
    }

    case "prompt_change":
    case "tool_policy_change": {
      // Protected surface. Only reachable via explicit human `approve` —
      // proposeCandidate() never marks these auto_approved, and the guard
      // above re-asserts it.
      if (candidate.status !== "approved") {
        throw new Error(
          `"${candidate.type}" requires an explicit human approval, not auto-approval.`,
        );
      }
      const agentId = payload.agentId as string;
      const updated = await db.agent.update({
        where: { id: agentId },
        data: {
          ...(candidate.type === "prompt_change"
            ? { systemPrompt: payload.systemPrompt as string }
            : {}),
          ...(candidate.type === "tool_policy_change"
            ? { toolPermissions: payload.toolPermissions as string[] }
            : {}),
        },
      });
      appliedTargetId = updated.id;
      break;
    }

    default:
      throw new Error(`Unhandled learning candidate type: ${candidate.type}`);
  }

  await db.learningCandidate.update({
    where: { id: candidate.id },
    data: { appliedTargetId },
  });

  return db.learningCandidate.findUniqueOrThrow({ where: { id: candidate.id } });
}

async function strengthenOrCreateEdge(
  fromObjectId: string,
  toObjectId: string,
  type: string,
  weightDelta: number,
  candidateId: string,
) {
  const existing = await db.knowledgeEdge.findUnique({
    where: { fromObjectId_toObjectId_type: { fromObjectId, toObjectId, type } },
  });

  if (!existing) {
    const edge = await db.knowledgeEdge.create({
      data: {
        fromObjectId,
        toObjectId,
        type,
        weight: Math.max(0, Math.min(1, 0.5 + weightDelta)),
        changeReason: `learning-candidate:${candidateId}`,
      },
    });
    await emitNeuralEvent({
      type: "edge.strengthened",
      payload: { edgeId: edge.id, candidateId },
    });
    return edge;
  }

  const newWeight = Math.max(0, Math.min(1, existing.weight + weightDelta));
  const edge = await db.knowledgeEdge.update({
    where: { id: existing.id },
    data: {
      weight: newWeight,
      version: { increment: 1 },
      changeReason: `learning-candidate:${candidateId}`,
    },
  });
  await emitNeuralEvent({
    type: weightDelta >= 0 ? "edge.strengthened" : "edge.weakened",
    payload: { edgeId: edge.id, candidateId, newWeight },
  });
  return edge;
}

/**
 * Roll back an applied candidate: reverses its effect where the reversal is
 * well-defined (relationship/confidence_update), or archives/supersedes for
 * content writes (memory/decision), and marks the original `rolled_back`.
 * History is preserved — nothing is deleted.
 */
export async function rollbackCandidate(candidateId: string, actorId: string) {
  const candidate = await db.learningCandidate.findUniqueOrThrow({
    where: { id: candidateId },
  });

  if (candidate.status !== "approved" && candidate.status !== "auto_approved") {
    throw new Error(
      `Cannot roll back candidate ${candidateId} — status is "${candidate.status}", not applied.`,
    );
  }

  const payload = candidate.proposedPayload as Record<string, unknown>;

  switch (candidate.type) {
    case "confidence_update": {
      const { agentId, knowledgeObjectId, outcome, magnitude } = payload as {
        agentId: string;
        knowledgeObjectId: string;
        outcome: "success" | "failure";
        magnitude?: number;
      };
      // Reverse the direction of the original adjustment.
      await adjustKnowledgeWeight(
        agentId,
        knowledgeObjectId,
        outcome === "success" ? "failure" : "success",
        magnitude,
      );
      break;
    }
    case "relationship": {
      const { fromObjectId, toObjectId, edgeType, weightDelta } = payload as {
        fromObjectId: string;
        toObjectId: string;
        edgeType: string;
        weightDelta?: number;
      };
      await strengthenOrCreateEdge(
        fromObjectId,
        toObjectId,
        edgeType,
        -(weightDelta ?? 0.1),
        candidateId,
      );
      break;
    }
    case "memory": {
      if (candidate.appliedTargetId) {
        await db.knowledgeObject.update({
          where: { id: candidate.appliedTargetId },
          data: { validTo: new Date(), changeReason: `rollback:${candidateId}`, changedBy: actorId },
        });
      }
      break;
    }
    case "decision": {
      if (candidate.appliedTargetId) {
        await db.decision.update({
          where: { id: candidate.appliedTargetId },
          data: {
            status: "superseded",
            changeReason: `rollback:${candidateId}`,
            changedBy: actorId,
          },
        });
      }
      break;
    }
    default:
      // Skill/procedure/contradiction/prompt/tool-policy rollbacks are
      // status-flip only for Phase A (mark deprecated/superseded via their
      // own tables) — full inverse-mutation support is Phase B/E scope.
      break;
  }

  const rolledBack = await db.learningCandidate.update({
    where: { id: candidateId },
    data: { status: "rolled_back" },
  });

  await emitNeuralEvent({
    type: "learning.rolled_back",
    payload: { candidateId, actorId },
  });

  return rolledBack;
}

/**
 * Future-outcome monitoring: if confidence in an applied candidate's
 * correctness has since dropped below `threshold`, automatically roll it
 * back. Intended to be called by a periodic job (Phase B) — real function,
 * not a stub, but Phase A has no scheduler wired up to call it yet.
 */
export async function monitorAndAutoRollback(
  candidateId: string,
  currentConfidence: number,
  threshold = 0.3,
) {
  if (currentConfidence >= threshold) return null;
  return rollbackCandidate(candidateId, "system:confidence-monitor");
}

export async function listPendingReview(riskLevel?: "low" | "medium" | "high") {
  return db.learningCandidate.findMany({
    where: { status: "proposed", ...(riskLevel ? { riskLevel } : {}) },
    orderBy: { createdAt: "asc" },
  });
}
