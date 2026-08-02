// Sentinel Neural Engine — Learning service (the controlled learning loop)
//
// Owns the LearningCandidate lifecycle: propose -> review -> apply -> rollback.
// This is the ONLY module that writes to canonical tables as a result of
// agent-observed experience. Every mutation is versioned and reversible.
//
// Hard rule enforcement lives in policy-service; this file calls it rather
// than re-implementing risk logic, so there's exactly one place the
// never-auto-approve list can drift.

import { createHash } from "node:crypto";
import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { emitLearningEvent } from "@/lib/learning/event-service";
import { recordReflection } from "@/lib/learning/reflection";
import type { AccessibleLearningScope } from "@/lib/learning/authorization";
import { recordTrustEvent } from "@/lib/learning/trust";
import {
  assertRiskTransitionAuthorized,
  canAutoApprove,
  classifyRiskLevel,
} from "./policy-service";
import { emitNeuralEvent } from "./event-service";
import { adjustKnowledgeWeight } from "./agent-profile-service";
import { recordContradiction } from "./contradiction-service";
import { writeAuditLog } from "@/lib/workspaces/audit";
import type {
  LearningCandidateType,
  ProposedLearningCandidateInput,
  RiskLevel,
} from "./types";

function toJson(value: unknown): Prisma.InputJsonValue {
  return (value ?? {}) as Prisma.InputJsonValue;
}

export interface ProposeResult {
  candidate: Awaited<ReturnType<typeof db.learningCandidate.create>>;
  autoApplied: boolean;
}

export interface ProposeCandidateOptions {
  transaction?: Prisma.TransactionClient;
  emitEvent?: boolean;
}

/**
 * Propose a learning candidate. If it's on the low-risk allowlist AND meets
 * evidence/confidence thresholds, it is applied immediately and marked
 * `auto_approved`. Otherwise it's left `proposed` for human review.
 */
export async function proposeCandidate(
  input: ProposedLearningCandidateInput,
  options: ProposeCandidateOptions = {},
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
  if (options.transaction && eligible) {
    throw new Error("Transactional proposal creation is only supported for review-gated candidates.");
  }
  const approvalContext = needsWorkspaceApproval
    ? await resolveApprovalContext(input, options.transaction ?? db)
    : null;
  const proposedPayload = toJson(input.proposedPayload);
  const proposalIdentity = createHash("sha256")
    .update(`${input.type}:${stableJson(input.proposedPayload)}`)
    .digest("hex");

  const write = async (tx: Prisma.TransactionClient) => {
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${`learning-proposal:${proposalIdentity}`})) IS NULL AS locked`;
    const identicalRollback = await tx.learningCandidate.findFirst({
      where: {
        type: input.type,
        status: "rolled_back",
        proposedPayload: { equals: proposedPayload },
      },
      select: { id: true },
    });
    // This is a permanent exact-payload block rather than a time-based
    // cooldown: elapsed time alone is not evidence that a regressing payload
    // became safe. The target/type or payload must materially change.
    if (identicalRollback) {
      throw new Error(
        `Learning candidate payload matches rolled-back candidate ${identicalRollback.id}; materially change the proposal before re-promotion.`,
      );
    }

    let created = await tx.learningCandidate.create({
      data: {
        experienceId: input.experienceId ?? null,
        evaluationId: input.evaluationId ?? null,
        type: input.type,
        proposedPayload,
        targetType: input.targetType ?? null,
        riskLevel: classification.riskLevel,
        evidenceCount,
        confidence,
        status: eligible ? "auto_approved" : "proposed",
        resolvedAt: eligible ? new Date() : null,
        knowledgeGapId: input.knowledgeGapId ?? null,
        problem: input.problem ?? null,
        rootCause: input.rootCause ?? null,
        rollbackCriteria: input.rollbackCriteria ? toJson(input.rollbackCriteria) : undefined,
        testPlan: input.testPlan ? toJson(input.testPlan) : undefined,
        rolloutPlan: input.rolloutPlan ? toJson(input.rolloutPlan) : undefined,
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
  };
  const candidate = options.transaction
    ? await write(options.transaction)
    : await db.$transaction(write);

  if (options.emitEvent !== false) {
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
  }

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

  const candidatePayload = candidate.proposedPayload as Record<string, unknown>;
  if (
    decision === "approve" &&
    candidatePayload.generationPipeline === "safe_skill_generation" &&
    candidatePayload.pipelineStage !== "awaiting_approval"
  ) {
    throw new Error("Generated skill cannot be approved before sandbox, benchmark, and shadow gates pass.");
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

  const reviewWorkspaceId = candidate.approvalRequest?.workspaceId ?? resolvedContext?.workspaceId;
  if (needsWorkspaceApproval && !reviewWorkspaceId) {
    throw new Error(
      `Learning candidate ${candidateId} has no resolvable workspace; protected review fails closed.`,
    );
  }
  if (
    needsWorkspaceApproval &&
    reviewWorkspaceId &&
    !(await reviewerHasWorkspacePermission(db, reviewerId, reviewWorkspaceId, "approval.review"))
  ) {
    throw new Error("Reviewer is not authorized to approve learning candidates in this workspace.");
  }

  const reviewed = await db.$transaction(async (tx) => {
    const humanReviewer = await tx.user.findUnique({
      where: { id: reviewerId },
      select: { id: true },
    });
    if (!humanReviewer) {
      throw new Error("Learning-candidate review requires an authenticated human reviewer.");
    }
    assertRiskTransitionAuthorized({
      classification,
      transition: `Learning-candidate ${decision}`,
      humanAuthorized: true,
      riskReducing: decision === "reject",
    });

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
/**
 * A canonical mutation plus its candidate-status/audit persistence used to
 * happen in two separate transactions — a failure between them could leave
 * production changed while Sentinel still reported the candidate as
 * unapplied, with no audit trail. Every branch below now runs inside one
 * transaction: the advisory lock, the re-verified candidate status, the
 * canonical write, the candidate update, and the audit log are all one
 * atomic unit. Only non-canonical notification events (emitNeuralEvent /
 * emitLearningEvent) fire after commit — see the per-service `client === db`
 * pattern in skill-service.ts / contradiction-service.ts for why.
 */
export async function applyLearningCandidate(candidateId: string) {
  type PostCommitEvent = () => Promise<void>;
  const postCommitEvents: PostCommitEvent[] = [];

  const applied = await db.$transaction(async (tx) => {
    // Locks on the candidate id itself — concurrent apply/rollback/re-apply
    // attempts serialize here rather than racing on the canonical mutation.
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${`learning-apply:${candidateId}`})) IS NULL AS locked`;

    const candidate = await tx.learningCandidate.findUniqueOrThrow({
      where: { id: candidateId },
      include: { experience: true, approvalRequest: true },
    });

    // Re-verified under the lock — this is the "expected current version"
    // check: if a concurrent call already applied or rolled back this
    // candidate between the caller's decision to apply and this transaction
    // acquiring the lock, that's caught here rather than double-applying.
    // `status` alone isn't enough — this codebase has no separate "applied"
    // status (appliedTargetId is what actually marks it), so a status-only
    // check would let a second concurrent caller sail through and, for any
    // create-type mutation (memory, decision, skill, ...), create a second
    // duplicate canonical row.
    if (candidate.status !== "approved" && candidate.status !== "auto_approved") {
      throw new Error(
        `Learning candidate ${candidateId} has status "${candidate.status}" — refusing to apply.`,
      );
    }
    if (candidate.appliedTargetId !== null) {
      throw new Error(
        `Learning candidate ${candidateId} was already applied (target ${candidate.appliedTargetId}) — refusing to apply again.`,
      );
    }

    const classification = classifyRiskLevel(
      candidate.type as LearningCandidateType,
      candidate.riskLevel as RiskLevel,
    );
    const humanReviewer = candidate.reviewedBy
      ? await tx.user.findUnique({ where: { id: candidate.reviewedBy }, select: { id: true } })
      : null;
    if (candidate.status === "approved") {
      const approvalAudit = candidate.reviewedBy
        ? await tx.auditLog.findFirst({
            where: {
              entityType: "LearningCandidate",
              entityId: candidate.id,
              action: "learning_candidate.approved",
              userId: candidate.reviewedBy,
            },
            select: { id: true },
          })
        : null;
      const linkedApprovalValid = !candidate.approvalRequest || (
        candidate.approvalRequest.status === "approved" &&
        candidate.approvalRequest.reviewerUserId === candidate.reviewedBy
      );
      if (!humanReviewer || !approvalAudit || !linkedApprovalValid) {
        throw new Error(
          "Approved learning candidate lacks matching human-review audit evidence.",
        );
      }
    }
    assertRiskTransitionAuthorized({
      classification,
      transition: `Apply ${candidate.type} learning candidate`,
      humanAuthorized: candidate.status === "approved" && Boolean(humanReviewer),
    });

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
        const weight = await adjustKnowledgeWeight(agentId, knowledgeObjectId, outcome, magnitude, tx);
        appliedTargetId = weight.id;
        postCommitEvents.push(() =>
          emitNeuralEvent({
            type: outcome === "success" ? "edge.strengthened" : "edge.weakened",
            payload: { agentId, knowledgeObjectId, candidateId },
          }),
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
        const edge = await strengthenOrCreateEdge(
          fromObjectId,
          toObjectId,
          edgeType,
          weightDelta ?? 0.1,
          candidate.id,
          tx,
          false,
        );
        appliedTargetId = edge.id;
        postCommitEvents.push(() =>
          emitNeuralEvent({
            type: (weightDelta ?? 0.1) >= 0 ? "edge.strengthened" : "edge.weakened",
            payload: { edgeId: edge.id, candidateId },
          }),
        );
        break;
      }

      case "memory": {
        const memory = await tx.memory.create({
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
        const decision = await tx.decision.create({
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
          tx,
        );
        appliedTargetId = contradiction.id;
        postCommitEvents.push(() =>
          emitNeuralEvent({
            type: "contradiction.detected",
            payload: { contradictionId: contradiction.id, subject: contradiction.subject },
          }),
        );
        break;
      }

      case "skill": {
        const skillVersionId = stringValue(payload.skillVersionId);
        const proposedSkillId = stringValue(payload.skillId);
        if (skillVersionId || proposedSkillId) {
          if (
            !skillVersionId ||
            !proposedSkillId ||
            payload.generationPipeline !== "safe_skill_generation" ||
            payload.pipelineStage !== "awaiting_approval"
          ) {
            throw new Error("Generated skill has not completed its governed promotion pipeline.");
          }
          const { activateSkillVersion } = await import("@/lib/learning/skill-versions");
          await activateSkillVersion(skillVersionId, {
            authorizedByUserId: candidate.reviewedBy ?? undefined,
            candidateId: candidate.id,
            transaction: tx,
          });
          appliedTargetId = proposedSkillId;
          break;
        }
        const { promoteFromPayload } = await import("./skill-service");
        const resolvedWorkspaceId =
          candidate.approvalRequest?.workspaceId ?? candidate.experience?.workspaceId ?? undefined;
        const promoted = await promoteFromPayload("skill", { ...payload, workspaceId: resolvedWorkspaceId }, tx);
        appliedTargetId = promoted?.id ?? null;
        postCommitEvents.push(() =>
          emitNeuralEvent({
            type: "skill.promoted",
            payload: { id: appliedTargetId, kind: "skill", name: payload.name, domain: payload.domain },
          }),
        );
        break;
      }

      case "procedure": {
        // Delegates to skill-service, which enforces promotion thresholds
        // independently — a LearningCandidate approval is necessary but not
        // sufficient; skill-service still checks evidence/success-rate.
        const { promoteFromPayload } = await import("./skill-service");
        const promoted = await promoteFromPayload("procedure", payload, tx);
        appliedTargetId = promoted?.id ?? null;
        postCommitEvents.push(() =>
          emitNeuralEvent({
            type: "skill.promoted",
            payload: { id: appliedTargetId, kind: "procedure", name: payload.name, domain: payload.domain },
          }),
        );
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
        const current = await tx.agent.findUniqueOrThrow({
          where: { id: agentId },
          select: { systemPrompt: true, toolPermissions: true },
        });
        // Exact-rollback capture: the prior value, byte-for-byte, before the
        // overwrite — this is what makes rollback for these two types a real
        // inverse instead of the status-flip-only fallback every other
        // unhandled type gets. See rollbackCandidateInTransaction below.
        const artifactType = candidate.type === "prompt_change" ? "agent_system_prompt" : "agent_tool_permissions";
        const priorValue = candidate.type === "prompt_change" ? current.systemPrompt : current.toolPermissions;
        const priorContent = { value: priorValue ?? null };
        const priorChecksum = createHash("sha256").update(JSON.stringify(priorContent)).digest("hex");
        const latestVersion = await tx.learningArtifactVersion.findFirst({
          where: { artifactType, artifactKey: agentId },
          orderBy: { version: "desc" },
          select: { id: true, version: true },
        });
        await tx.learningArtifactVersion.create({
          data: {
            artifactType,
            artifactKey: agentId,
            version: (latestVersion?.version ?? 0) + 1,
            content: priorContent,
            checksum: priorChecksum,
            status: "retired",
            candidateId: candidate.id,
            previousVersionId: latestVersion?.id ?? null,
            retiredAt: new Date(),
          },
        });
        const updated = await tx.agent.update({
          where: { id: agentId },
          data: {
            ...(candidate.type === "prompt_change" ? { systemPrompt: payload.systemPrompt as string } : {}),
            ...(candidate.type === "tool_policy_change" ? { toolPermissions: payload.toolPermissions as string[] } : {}),
          },
        });
        appliedTargetId = updated.id;
        break;
      }

      default:
        throw new Error(`Unhandled learning candidate type: ${candidate.type}`);
    }

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

  for (const fire of postCommitEvents) {
    await fire().catch(() => {
      // Notification-only — a failure here must never look like the apply
      // itself failed; the canonical mutation already committed.
    });
  }

  return applied;
}

async function strengthenOrCreateEdge(
  fromObjectId: string,
  toObjectId: string,
  type: string,
  weightDelta: number,
  candidateId: string,
  client: Pick<Prisma.TransactionClient, "knowledgeEdge"> = db,
  emitEvent = true,
) {
  const existing = await client.knowledgeEdge.findUnique({
    where: { fromObjectId_toObjectId_type: { fromObjectId, toObjectId, type } },
  });

  if (!existing) {
    const edge = await client.knowledgeEdge.create({
      data: {
        fromObjectId,
        toObjectId,
        type,
        weight: Math.max(0, Math.min(1, 0.5 + weightDelta)),
        changeReason: `learning-candidate:${candidateId}`,
      },
    });
    if (emitEvent) {
      await emitNeuralEvent({
        type: "edge.strengthened",
        payload: { edgeId: edge.id, candidateId },
      });
    }
    return edge;
  }

  const newWeight = Math.max(0, Math.min(1, existing.weight + weightDelta));
  const edge = await client.knowledgeEdge.update({
    where: { id: existing.id },
    data: {
      weight: newWeight,
      version: { increment: 1 },
      changeReason: `learning-candidate:${candidateId}`,
    },
  });
  if (emitEvent) {
    await emitNeuralEvent({
      type: weightDelta >= 0 ? "edge.strengthened" : "edge.weakened",
      payload: { edgeId: edge.id, candidateId, newWeight },
    });
  }
  return edge;
}

/**
 * Roll back an applied candidate: reverses its effect where the reversal is
 * well-defined (relationship/confidence_update), or archives/supersedes for
 * content writes (memory/decision), and marks the original `rolled_back`.
 * History is preserved — nothing is deleted.
 */
interface RollbackCandidateOptions {
  transaction?: Prisma.TransactionClient;
  emitEvent?: boolean;
}

export async function rollbackCandidate(
  candidateId: string,
  actorId: string,
  reason?: string,
  options: RollbackCandidateOptions = {},
) {
  const write = (tx: Prisma.TransactionClient) =>
    rollbackCandidateInTransaction(tx, candidateId, actorId, reason);
  const rolledBack = options.transaction
    ? await write(options.transaction)
    : await db.$transaction(write);

  if (options.emitEvent !== false) {
    await emitNeuralEvent({
      type: "learning.rolled_back",
      payload: { candidateId, actorId, reason: reason ?? null },
    });
  }

  return rolledBack;
}

async function rollbackCandidateInTransaction(
  tx: Prisma.TransactionClient,
  candidateId: string,
  actorId: string,
  reason?: string,
) {
  await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${`learning-rollback:${candidateId}`})) IS NULL AS locked`;
  const candidate = await tx.learningCandidate.findUniqueOrThrow({
    where: { id: candidateId },
    include: { experience: true, approvalRequest: true },
  });

  if (candidate.status !== "approved" && candidate.status !== "auto_approved") {
    throw new Error(
      `Cannot roll back candidate ${candidateId} — status is "${candidate.status}", not applied.`,
    );
  }

  const rollbackClassification = classifyRiskLevel(
    candidate.type as LearningCandidateType,
    candidate.riskLevel as RiskLevel,
  );
  assertRiskTransitionAuthorized({
    classification: rollbackClassification,
    transition: `Roll back ${candidate.type} learning candidate`,
    humanAuthorized: false,
    riskReducing: true,
  });

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
        tx,
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
        tx,
        false,
      );
      break;
    }
    case "memory": {
      if (candidate.appliedTargetId) {
        await tx.memory.update({
          where: { id: candidate.appliedTargetId },
          data: { archived: true },
        });
      }
      break;
    }
    case "decision": {
      if (candidate.appliedTargetId) {
        await tx.decision.update({
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
    case "skill": {
      const skillVersionId = stringValue(payload.skillVersionId);
      if (skillVersionId) {
        const { rollbackSkillVersion } = await import("@/lib/learning/skill-versions");
        await rollbackSkillVersion(skillVersionId, { transaction: tx });
      }
      break;
    }
    case "prompt_change":
    case "tool_policy_change": {
      // Exact inverse: restore the byte-for-byte prior value captured in
      // applyLearningCandidate's LearningArtifactVersion row, not just a
      // status flip. If that capture is somehow missing (e.g. a row applied
      // before this capture existed), fail rather than guess.
      const agentId = payload.agentId as string;
      const artifactType = candidate.type === "prompt_change" ? "agent_system_prompt" : "agent_tool_permissions";
      const priorVersion = await tx.learningArtifactVersion.findFirst({
        where: { artifactType, artifactKey: agentId, candidateId: candidate.id },
        orderBy: { version: "desc" },
      });
      if (!priorVersion) {
        throw new Error(
          `Cannot exactly roll back ${candidate.type} for agent ${agentId} — no captured prior value found; manual rollback required.`,
        );
      }
      const priorContent = priorVersion.content as { value: unknown };
      const restoredChecksum = createHash("sha256").update(JSON.stringify(priorContent)).digest("hex");
      if (restoredChecksum !== priorVersion.checksum) {
        throw new Error(
          `Captured prior value for ${candidate.type} on agent ${agentId} failed checksum verification — refusing to restore a corrupted snapshot.`,
        );
      }
      await tx.agent.update({
        where: { id: agentId },
        data: {
          ...(candidate.type === "prompt_change" ? { systemPrompt: priorContent.value as string | null } : {}),
          ...(candidate.type === "tool_policy_change" ? { toolPermissions: (priorContent.value as string[]) ?? [] } : {}),
        },
      });
      await tx.learningArtifactVersion.update({
        where: { id: priorVersion.id },
        data: { status: "active", activatedAt: new Date(), retiredAt: null },
      });
      break;
    }
    default:
      // Procedure/contradiction rollbacks are status-flip only — no exact
      // inverse is defined for them yet. This is a real limitation, not a
      // silent gap: policy-service's classification for these types should
      // treat them as manual_rollback_only rather than advertising automatic
      // rollback (see docs/reviews/PR21_POST_MERGE_RECONCILIATION.md).
      break;
  }

  const systemActor = actorId.startsWith("system:");
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

async function reviewerHasWorkspacePermission(
  client: Pick<Prisma.TransactionClient, "workspace" | "roleAssignment">,
  userId: string,
  workspaceId: string,
  permissionKey: string,
): Promise<boolean> {
  const workspace = await client.workspace.findUnique({
    where: { id: workspaceId },
    select: { ownerId: true },
  });
  if (!workspace) return false;
  if (workspace.ownerId === userId) return true;
  const assignment = await client.roleAssignment.findFirst({
    where: {
      workspaceId,
      OR: [{ userId }, { team: { memberUserIds: { has: userId } } }],
      AND: [{ OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }] }],
      role: {
        permissions: {
          some: { OR: [{ key: permissionKey }, { key: "*" }] },
        },
      },
    },
    select: { id: true },
  });
  return Boolean(assignment);
}

async function resolveApprovalContext(
  input: ApprovalContextInput,
  client: Pick<Prisma.TransactionClient, "experience" | "evaluation" | "project" | "agent"> = db,
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
    experience = await client.experience.findUnique({
      where: { id: input.experienceId },
      select: { workspaceId: true, projectId: true, agentId: true },
    });
  } else if (input.evaluationId) {
    const evaluation = await client.evaluation.findUnique({
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
    const project = await client.project.findUnique({
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

  if (agentId) {
    const agent = await client.agent.findUnique({
      where: { id: agentId },
      select: { workspaceId: true },
    });
    if (workspaceId && agent?.workspaceId && agent.workspaceId !== workspaceId) {
      throw new Error(
        `Learning candidate agent ${agentId} does not belong to workspace ${workspaceId}.`,
      );
    }
    workspaceId ??= agent?.workspaceId ?? null;
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
 * correctness has since dropped below `threshold`, atomically disable its
 * rollout flags, reverse the candidate, penalize domain trust, and preserve
 * the operational evidence in audit, learning-event, and reflection logs.
 */
export async function monitorAndAutoRollback(
  candidateId: string,
  currentConfidence: number,
  threshold = 0.3,
) {
  if (currentConfidence >= threshold) return null;
  const actorId = "system:confidence-monitor";
  const reason =
    `Derived confidence ${currentConfidence.toFixed(3)} fell below ` +
    `rollback threshold ${threshold.toFixed(3)}.`;

  const result = await db.$transaction(async (tx) => {
    const candidate = await tx.learningCandidate.findUniqueOrThrow({
      where: { id: candidateId },
      include: { experience: true, approvalRequest: true },
    });
    const payload = candidate.proposedPayload as Record<string, unknown>;
    const agentId = stringValue(payload.agentId);
    if (!agentId) {
      throw new Error(
        `Cannot automatically roll back candidate ${candidateId} without an agentId in proposedPayload.`,
      );
    }
    const domain =
      stringValue(payload.trustDomain) ??
      stringValue(payload.domain) ??
      "knowledge_retrieval";

    const activeFlags = await tx.featureFlag.findMany({
      where: { learningCandidateId: candidateId, enabled: true },
      select: { id: true, key: true },
    });
    if (activeFlags.length > 0) {
      await tx.featureFlag.updateMany({
        where: { id: { in: activeFlags.map((flag) => flag.id) } },
        data: { enabled: false },
      });
    }

    const rolledBack = await rollbackCandidate(candidateId, actorId, reason, {
      transaction: tx,
      emitEvent: false,
    });
    const trust = await recordTrustEvent({
      agentId,
      domain,
      eventType: "candidate_failed_or_rolled_back",
      reason,
      traceId: candidate.experienceId,
      candidateId,
    }, tx);

    const workspaceId =
      candidate.approvalRequest?.workspaceId ?? candidate.experience?.workspaceId ?? undefined;
    const projectId =
      candidate.approvalRequest?.projectId ??
      candidate.experience?.projectId ??
      projectIdFromPayload(candidate.proposedPayload) ??
      undefined;
    await writeAuditLog({
      workspaceId,
      projectId,
      approvalRequestId: candidate.approvalRequestId,
      actorType: "system",
      action: "learning_candidate.automatic_rollback",
      entityType: "LearningCandidate",
      entityId: candidateId,
      details: {
        reason,
        currentConfidence,
        threshold,
        disabledFeatureFlags: activeFlags,
        trustEventId: trust.event.id,
      },
    }, tx);
    await emitLearningEvent({
      eventType: "rollback_triggered",
      sourceType: "learning_candidate",
      sourceId: candidateId,
      agentId,
      workspaceId,
      projectId,
      traceId: candidate.experienceId ?? undefined,
      severity: "warning",
      payload: {
        reason,
        currentConfidence,
        threshold,
        disabledFeatureFlagKeys: activeFlags.map((flag) => flag.key),
        trustEventId: trust.event.id,
      },
    }, tx);
    const reflection = await recordReflection({
      traceId: candidate.experienceId ?? undefined,
      agentId,
      workspaceId,
      projectId,
      reflectionType: "automatic",
      summary: `Automatic rollback of ${candidate.type} candidate ${candidateId}`,
      whatFailed: reason,
      unexpectedResults: "Production evidence regressed below the configured confidence threshold.",
      reusableLesson: "A rolled-back payload must be materially changed before it can be proposed again.",
      suggestedImprovement: "Revise the proposed payload and validate it against fresh evidence before promotion.",
      confidence: currentConfidence,
    }, { client: tx, emitEvent: false });

    return { rolledBack, reflectionId: reflection.id };
  });

  await emitNeuralEvent({
    type: "learning.rolled_back",
    payload: {
      candidateId,
      actorId,
      reason,
      automatic: true,
      reflectionId: result.reflectionId,
    },
  });
  return result.rolledBack;
}

function stableJson(value: unknown): string {
  return JSON.stringify(canonicalJson(value));
}

function canonicalJson(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalJson);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .filter(([, entry]) => entry !== undefined)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, entry]) => [key, canonicalJson(entry)]),
    );
  }
  return value;
}

export async function listPendingReview(
  riskLevel?: "low" | "medium" | "high",
  scope?: AccessibleLearningScope,
) {
  return db.learningCandidate.findMany({
    where: {
      status: "proposed",
      ...(riskLevel ? { riskLevel } : {}),
      ...(scope
        ? {
            OR: [
              { approvalRequest: { is: { workspaceId: { in: scope.workspaceIds } } } },
              {
                experience: {
                  is: {
                    OR: [
                      { workspaceId: { in: scope.workspaceIds } },
                      { projectId: { in: scope.projectIds } },
                      { agentId: { in: scope.agentIds } },
                    ],
                  },
                },
              },
              {
                knowledgeGap: {
                  is: {
                    OR: [
                      { workspaceId: { in: scope.workspaceIds } },
                      { projectId: { in: scope.projectIds } },
                      { agentId: { in: scope.agentIds } },
                    ],
                  },
                },
              },
            ],
          }
        : {}),
    },
    orderBy: { createdAt: "asc" },
  });
}
