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
import { writeAuditLog } from "@/lib/workspaces/audit";
import type {
  LearningCandidateType,
  ProposedLearningCandidateInput,
} from "./types";

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

  const needsWorkspaceApproval =
    !classification.autoApproveEligible &&
    (classification.riskLevel === "medium" || classification.riskLevel === "high");
  const approvalContext = needsWorkspaceApproval
    ? await resolveApprovalContext(input)
    : null;

  const candidate = await db.$transaction(async (tx) => {
    let created = await tx.learningCandidate.create({
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

    if (needsWorkspaceApproval && approvalContext) {
      const approval = await createCandidateApproval(
        tx,
        created,
        approvalContext,
        classification.reason,
      );
      created = await tx.learningCandidate.update({
        where: { id: created.id },
        data: { approvalRequestId: approval.id },
      });
    }

    return created;
  });

  await emitNeuralEvent({
    type: "learning.proposed",
    payload: {
      candidateId: candidate.id,
      type: candidate.type,
      riskLevel: candidate.riskLevel,
      autoApplied: eligible,
      approvalRequestId: candidate.approvalRequestId,
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
  reason?: string,
) {
  const candidate = await db.learningCandidate.findUniqueOrThrow({
    where: { id: candidateId },
    include: { experience: true, approvalRequest: true },
  });

  if (candidate.status !== "proposed") {
    throw new Error(
      `Learning candidate ${candidateId} is already "${candidate.status}" — cannot review again.`,
    );
  }

  const classification = classifyRiskLevel(
    candidate.type as LearningCandidateType,
    candidate.riskLevel as "low" | "medium" | "high",
  );
  const needsWorkspaceApproval =
    !classification.autoApproveEligible &&
    (classification.riskLevel === "medium" || classification.riskLevel === "high");
  const resolvedContext = await resolveApprovalContext({
    experienceId: candidate.experienceId,
    evaluationId: candidate.evaluationId,
    proposedPayload: candidate.proposedPayload as Record<string, unknown>,
    type: candidate.type as LearningCandidateType,
  });

  if (needsWorkspaceApproval && !candidate.approvalRequest && !resolvedContext) {
    // System scans can produce candidates without an Experience or any other
    // tenant context. ApprovalRequest.workspaceId is mandatory, so inventing a
    // workspace here risks crossing tenant boundaries. Preserve the existing
    // status-only human review path and make that fallback visible to ops.
    console.warn(
      `[neural] Learning candidate ${candidateId} has no resolvable workspace; using status-only review without an ApprovalRequest.`,
    );
  }

  const reviewed = await db.$transaction(async (tx) => {
    let approval = candidate.approvalRequest;
    if (needsWorkspaceApproval && !approval && resolvedContext) {
      approval = await createCandidateApproval(
        tx,
        candidate,
        resolvedContext,
        classification.reason,
      );
      await tx.learningCandidate.update({
        where: { id: candidate.id },
        data: { approvalRequestId: approval.id },
      });
    }

    if (approval) {
      if (approval.status === "pending") {
        approval = await tx.approvalRequest.update({
          where: { id: approval.id },
          data: {
            status: decision === "approve" ? "approved" : "rejected",
            reviewerUserId: reviewerId,
            decisionNote: reason ?? null,
            decidedAt: new Date(),
          },
        });
        await writeAuditLog({
          workspaceId: approval.workspaceId,
          projectId: approval.projectId,
          approvalRequestId: approval.id,
          userId: reviewerId,
          actorType: "user",
          action: `approval.${approval.status}`,
          entityType: "approvalRequest",
          entityId: approval.id,
          details: {
            previousStatus: "pending",
            status: approval.status,
            decisionNote: reason ?? null,
            learningCandidateId: candidate.id,
          },
        }, tx);
      } else if (approval.status !== (decision === "approve" ? "approved" : "rejected")) {
        throw new Error(
          `Approval request ${approval.id} is already "${approval.status}" and conflicts with decision "${decision}".`,
        );
      }
    }

    const nextStatus = decision === "approve" ? "approved" : "rejected";
    const updated = await tx.learningCandidate.update({
      where: { id: candidateId },
      data: {
        status: nextStatus,
        reviewedBy: reviewerId,
        resolvedAt: new Date(),
        ...(approval ? { approvalRequestId: approval.id } : {}),
      },
    });
    const auditScope = approval ?? resolvedContext;
    await writeAuditLog({
      workspaceId: auditScope?.workspaceId,
      projectId: auditScope?.projectId ?? projectIdFromPayload(candidate.proposedPayload),
      approvalRequestId: approval?.id,
      userId: reviewerId,
      actorType: "user",
      action: `learning_candidate.${nextStatus}`,
      entityType: "LearningCandidate",
      entityId: candidate.id,
      details: {
        decision,
        reviewerId,
        reason: reason ?? null,
        riskLevel: candidate.riskLevel,
        candidateType: candidate.type,
        previousStatus: candidate.status,
        status: updated.status,
        approvalRequestId: approval?.id ?? null,
      },
    }, tx);
    return updated;
  });

  if (decision === "reject") {
    await emitNeuralEvent({
      type: "learning.rejected",
      payload: { candidateId, reviewerId, reason: reason ?? null },
    });
    return reviewed;
  }
  await emitNeuralEvent({
    type: "learning.approved",
    payload: { candidateId, reviewerId, reason: reason ?? null },
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
    include: { experience: true, approvalRequest: true },
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
      const memory = await db.memory.create({
        data: {
          type: (payload.memoryType as string) ?? "pattern",
          scope: (payload.scope as string) ?? "project",
          owner: (payload.owner as string) ?? "neural-engine",
          content: payload.content as string,
          tags: (payload.tags as string[]) ?? [],
          confidence: candidate.confidence,
          importanceScore: (payload.importanceScore as number) ?? 0.5,
          source: `neural-engine:learning-candidate:${candidate.id}`,
          projectId: (payload.projectId as string) ?? null,
        },
      });
      appliedTargetId = memory.id;
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

  const applied = await db.$transaction(async (tx) => {
    const updated = await tx.learningCandidate.update({
      where: { id: candidate.id },
      data: { appliedTargetId },
    });
    const humanReviewerId = candidate.status === "approved" ? candidate.reviewedBy : null;
    await writeAuditLog({
      workspaceId: candidate.approvalRequest?.workspaceId ?? candidate.experience?.workspaceId,
      projectId:
        candidate.approvalRequest?.projectId ??
        candidate.experience?.projectId ??
        projectIdFromPayload(candidate.proposedPayload),
      approvalRequestId: candidate.approvalRequestId,
      userId: humanReviewerId,
      actorType: humanReviewerId ? "user" : "system",
      action: "learning_candidate.applied",
      entityType: "LearningCandidate",
      entityId: candidate.id,
      details: {
        riskLevel: candidate.riskLevel,
        candidateType: candidate.type,
        reviewerId: humanReviewerId,
        approvalMode: candidate.status === "auto_approved" ? "automatic" : "human",
        appliedTargetId,
      },
    }, tx);
    return updated;
  });

  return applied;
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
export async function rollbackCandidate(candidateId: string, actorId: string, reason?: string) {
  const candidate = await db.learningCandidate.findUniqueOrThrow({
    where: { id: candidateId },
    include: { experience: true, approvalRequest: true },
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
        await db.memory.update({
          where: { id: candidate.appliedTargetId },
          data: { archived: true },
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

  const systemActor = actorId.startsWith("system:");
  const rolledBack = await db.$transaction(async (tx) => {
    const updated = await tx.learningCandidate.update({
      where: { id: candidateId },
      data: { status: "rolled_back" },
    });
    await writeAuditLog({
      workspaceId: candidate.approvalRequest?.workspaceId ?? candidate.experience?.workspaceId,
      projectId:
        candidate.approvalRequest?.projectId ??
        candidate.experience?.projectId ??
        projectIdFromPayload(candidate.proposedPayload),
      approvalRequestId: candidate.approvalRequestId,
      userId: systemActor ? null : actorId,
      actorType: systemActor ? "system" : "user",
      action: "learning_candidate.rolled_back",
      entityType: "LearningCandidate",
      entityId: candidate.id,
      details: {
        riskLevel: candidate.riskLevel,
        candidateType: candidate.type,
        actorId,
        reason: reason ?? null,
        previousStatus: candidate.status,
        status: updated.status,
        appliedTargetId: candidate.appliedTargetId,
      },
    }, tx);
    return updated;
  });

  await emitNeuralEvent({
    type: "learning.rolled_back",
    payload: { candidateId, actorId, reason: reason ?? null },
  });

  return rolledBack;
}

function projectIdFromPayload(payload: Prisma.JsonValue): string | null {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return null;
  const projectId = (payload as Record<string, unknown>).projectId;
  return typeof projectId === "string" ? projectId : null;
}

interface ApprovalContext {
  workspaceId: string;
  projectId: string | null;
}

interface ApprovalContextInput {
  experienceId?: string | null;
  evaluationId?: string | null;
  proposedPayload: Record<string, unknown>;
  type: LearningCandidateType;
}

async function resolveApprovalContext(
  input: ApprovalContextInput,
): Promise<ApprovalContext | null> {
  const payload = input.proposedPayload;
  let workspaceId = stringValue(payload.workspaceId);
  let projectId = stringValue(payload.projectId);
  let agentId = stringValue(payload.agentId) ?? stringValue(payload.owner);

  let experience: {
    workspaceId: string | null;
    projectId: string | null;
    agentId: string;
  } | null = null;
  if (input.experienceId) {
    experience = await db.experience.findUnique({
      where: { id: input.experienceId },
      select: { workspaceId: true, projectId: true, agentId: true },
    });
  } else if (input.evaluationId) {
    const evaluation = await db.evaluation.findUnique({
      where: { id: input.evaluationId },
      select: {
        experience: {
          select: { workspaceId: true, projectId: true, agentId: true },
        },
      },
    });
    experience = evaluation?.experience ?? null;
  }

  workspaceId ??= experience?.workspaceId ?? null;
  projectId ??= experience?.projectId ?? null;
  agentId ??= experience?.agentId ?? null;

  if (projectId) {
    const project = await db.project.findUnique({
      where: { id: projectId },
      select: { workspaceId: true },
    });
    if (workspaceId && project?.workspaceId && project.workspaceId !== workspaceId) {
      throw new Error(
        `Learning candidate project ${projectId} does not belong to workspace ${workspaceId}.`,
      );
    }
    workspaceId ??= project?.workspaceId ?? null;
  }

  if (!workspaceId && agentId) {
    const agent = await db.agent.findUnique({
      where: { id: agentId },
      select: { workspaceId: true },
    });
    workspaceId = agent?.workspaceId ?? null;
  }

  return workspaceId ? { workspaceId, projectId: projectId ?? null } : null;
}

async function createCandidateApproval(
  tx: Prisma.TransactionClient,
  candidate: {
    id: string;
    type: string;
    riskLevel: string;
    targetType: string | null;
    evidenceCount: number;
    confidence: number;
    proposedPayload: Prisma.JsonValue;
  },
  context: ApprovalContext,
  policyReason: string,
) {
  const approval = await tx.approvalRequest.create({
    data: {
      workspaceId: context.workspaceId,
      projectId: context.projectId,
      title: `Review learning candidate: ${candidate.type}`,
      description: policyReason,
      type: "learning_candidate_review",
      payload: {
        learningCandidateId: candidate.id,
        candidateType: candidate.type,
        riskLevel: candidate.riskLevel,
        targetType: candidate.targetType,
        evidenceCount: candidate.evidenceCount,
        confidence: candidate.confidence,
        proposedPayload: candidate.proposedPayload,
      } as Prisma.InputJsonValue,
    },
  });
  await writeAuditLog({
    workspaceId: context.workspaceId,
    projectId: context.projectId,
    approvalRequestId: approval.id,
    actorType: "system",
    action: "approval.requested",
    entityType: "approvalRequest",
    entityId: approval.id,
    details: {
      status: "pending",
      type: approval.type,
      learningCandidateId: candidate.id,
      riskLevel: candidate.riskLevel,
    },
  }, tx);
  return approval;
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
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
  return rollbackCandidate(
    candidateId,
    "system:confidence-monitor",
    `Derived confidence ${currentConfidence.toFixed(3)} fell below rollback threshold ${threshold.toFixed(3)}.`,
  );
}

export async function listPendingReview(riskLevel?: "low" | "medium" | "high") {
  return db.learningCandidate.findMany({
    where: { status: "proposed", ...(riskLevel ? { riskLevel } : {}) },
    orderBy: { createdAt: "asc" },
  });
}
