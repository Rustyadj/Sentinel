import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { writeAuditLog } from "@/lib/workspaces/audit";
import { assertInputSize } from "./security";
import { evaluateAdmission } from "./admission-policy";
import { emitAdaptiveEvent } from "./event-service";
import { requireAdaptiveScope } from "./scope";
import type { ProposeMemoryCandidateInput } from "./types";

const clamp = (value: number) => Math.max(0, Math.min(1, value));
const json = (value: unknown) => value as Prisma.InputJsonValue;

export async function proposeMemoryCandidate(input: ProposeMemoryCandidateInput, actorUserId: string) {
  assertInputSize(input.content);
  await requireAdaptiveScope({ ...input, actorUserId, permission: "knowledge.write" });
  if (!input.provenance?.capturedAt || !Array.isArray(input.provenance.sourceIds) || !Array.isArray(input.provenance.evidenceIds)) {
    throw new Error("Complete provenance with sourceIds, evidenceIds, and capturedAt is required.");
  }
  if (input.sourceType.startsWith("explicit_user") || input.sourceType === "human_correction") {
    if (input.proposedBy !== actorUserId) throw new Error("Human-authored sources must be bound to the acting user.");
  }

  const normalized = { ...input, sourceTrust: clamp(input.sourceTrust), confidence: clamp(input.confidence), importance: clamp(input.importance), risk: clamp(input.risk) };
  const decision = evaluateAdmission(normalized);
  const candidate = await db.memoryCandidate.create({ data: {
    organizationId: input.organizationId, workspaceId: input.workspaceId,
    projectId: input.projectId,
    userId: input.userId ?? (!input.organizationId && !input.workspaceId && !input.projectId ? actorUserId : undefined),
    agentId: input.agentId, runId: input.runId, conversationId: input.conversationId,
    candidateType: input.candidateType, content: input.content,
    structuredPayload: input.structuredPayload ? json(input.structuredPayload) : undefined,
    sourceType: input.sourceType, sourceTrust: normalized.sourceTrust,
    confidence: normalized.confidence, importance: normalized.importance, risk: normalized.risk,
    provenance: json(input.provenance), expiresAt: input.expiresAt ? new Date(input.expiresAt) : undefined,
    reviewAt: input.reviewAt ? new Date(input.reviewAt) : undefined,
    supersedesId: input.supersedesId, contradictsIds: input.contradictsIds ?? [],
    proposedBy: input.proposedBy, status: decision.status,
    quarantineReasons: decision.reasons,
  }});

  await emitAdaptiveEvent({
    type: decision.status === "quarantined" ? "memory.quarantined" : "memory.candidate_created",
    userId: actorUserId, agentId: input.agentId, runId: input.runId,
    organizationId: input.organizationId, workspaceId: input.workspaceId, projectId: input.projectId,
    result: decision.status, payload: { candidateId: candidate.id, reasons: decision.reasons },
  });
  if (decision.status === "auto_approved") return promoteMemoryCandidate(candidate.id, actorUserId, true);
  return candidate;
}

function canonicalScope(candidate: { projectId: string | null; workspaceId: string | null; organizationId: string | null; userId: string | null; agentId: string | null }) {
  if (candidate.projectId) return "project";
  if (candidate.workspaceId) return "workspace";
  if (candidate.organizationId) return "organization";
  if (candidate.agentId) return "agent";
  return "user";
}

async function promoteMemoryCandidate(candidateId: string, reviewerId: string, automatic = false) {
  const candidate = await db.memoryCandidate.findUniqueOrThrow({ where: { id: candidateId } });
  if (!automatic && candidate.status !== "pending") throw new Error(`Candidate is ${candidate.status}, not pending.`);
  if (automatic && candidate.status !== "auto_approved") throw new Error("Automatic promotion requires auto_approved status.");
  if (candidate.agentId && reviewerId === candidate.agentId) throw new Error("Agents cannot approve their own memory candidates.");

  const result = await db.$transaction(async (tx) => {
    const now = new Date();
    let typedTargetId: string | null = null;
    const payload = (candidate.structuredPayload ?? {}) as Record<string, unknown>;
    if (candidate.candidateType === "decision") {
      typedTargetId = (await tx.decision.create({ data: {
        title: String(payload.title ?? candidate.content.slice(0, 120)), summary: candidate.content,
        status: "approved", rationale: typeof payload.rationale === "string" ? payload.rationale : null,
        sourceLinks: json((candidate.provenance as { sourceIds?: string[] }).sourceIds ?? []),
        createdBy: candidate.proposedBy, approvedBy: reviewerId, projectId: candidate.projectId,
        userId: candidate.userId, changeReason: `memory-candidate:${candidate.id}`, changedBy: reviewerId,
      }})).id;
    } else if (candidate.candidateType === "procedure") {
      typedTargetId = (await tx.procedure.create({ data: {
        name: String(payload.name ?? candidate.content.slice(0, 80)), description: candidate.content,
        domain: String(payload.domain ?? "general"), steps: json(payload.steps ?? []),
        requiredTools: Array.isArray(payload.requiredTools) ? payload.requiredTools.map(String) : [],
        evidenceLinks: (candidate.provenance as { evidenceIds?: string[] }).evidenceIds ?? [],
        owner: reviewerId, status: "active",
      }})).id;
    } else if (candidate.candidateType === "policy") {
      typedTargetId = (await tx.policy.create({ data: {
        name: String(payload.name ?? candidate.content.slice(0, 80)), domain: String(payload.domain ?? "general"),
        description: candidate.content, rules: json(payload.rules ?? {}), appliesTo: json(payload.appliesTo ?? {}),
        riskLevel: "high", status: "active", owner: reviewerId,
      }})).id;
    } else if (candidate.candidateType === "relationship") {
      const fromObjectId = String(payload.fromObjectId ?? "");
      const toObjectId = String(payload.toObjectId ?? "");
      const type = String(payload.type ?? "related_to");
      if (!fromObjectId || !toObjectId) throw new Error("Relationship candidates require fromObjectId and toObjectId.");
      typedTargetId = (await tx.knowledgeEdge.upsert({
        where: { fromObjectId_toObjectId_type: { fromObjectId, toObjectId, type } },
        update: { weight: candidate.confidence, version: { increment: 1 }, changeReason: `memory-candidate:${candidate.id}`, changedBy: reviewerId },
        create: { fromObjectId, toObjectId, type, weight: candidate.confidence, metadata: json({ provenance: candidate.provenance }), changeReason: `memory-candidate:${candidate.id}`, changedBy: reviewerId },
      })).id;
    }

    let knowledgeObjectId: string | null = null;
    if (candidate.candidateType !== "relationship") {
      const object = await tx.knowledgeObject.create({ data: {
        type: candidate.candidateType === "procedure" ? "Skill" : candidate.candidateType === "decision" ? "Decision" : candidate.candidateType === "policy" ? "Policy" : "Memory",
        title: String(payload.title ?? payload.name ?? candidate.content.slice(0, 120)), summary: candidate.content,
        sourceType: typedTargetId ? candidate.candidateType : "memory_candidate",
        sourceId: typedTargetId ?? candidate.id, scope: canonicalScope(candidate),
        workspaceId: candidate.workspaceId, projectId: candidate.projectId,
        organizationId: candidate.organizationId, userId: candidate.userId,
        metadata: json({ candidateId: candidate.id, provenance: candidate.provenance, sourceTrust: candidate.sourceTrust, confidence: candidate.confidence, importance: candidate.importance }),
        changeReason: `memory-candidate:${candidate.id}`, changedBy: reviewerId,
      }});
      knowledgeObjectId = object.id;
      if (candidate.supersedesId) {
        const priorCandidate = await tx.memoryCandidate.findUnique({ where: { id: candidate.supersedesId } });
        const priorId = priorCandidate?.appliedTargetId ?? candidate.supersedesId;
        const prior = await tx.knowledgeObject.findUnique({ where: { id: priorId } });
        if (prior?.validTo === null) {
          await tx.knowledgeObject.update({ where: { id: prior.id }, data: { validTo: now, supersededByObjectId: object.id } });
        }
      }
    }
    const updated = await tx.memoryCandidate.update({ where: { id: candidate.id }, data: {
      status: automatic ? "auto_approved" : "approved", reviewedBy: reviewerId,
      resolvedAt: now, appliedTargetType: knowledgeObjectId ? "knowledge_object" : "knowledge_edge",
      appliedTargetId: knowledgeObjectId ?? typedTargetId,
    }});
    await tx.auditLog.create({ data: {
      workspaceId: candidate.workspaceId, projectId: candidate.projectId, userId: reviewerId,
      actorType: "user", action: "memory.approved", entityType: "memoryCandidate",
      entityId: candidate.id, details: json({ automatic, appliedTargetId: updated.appliedTargetId }),
    }});
    return updated;
  });
  await emitAdaptiveEvent({ type: "memory.approved", userId: reviewerId, agentId: candidate.agentId ?? undefined,
    runId: candidate.runId ?? undefined, workspaceId: candidate.workspaceId ?? undefined,
    projectId: candidate.projectId ?? undefined, organizationId: candidate.organizationId ?? undefined,
    result: automatic ? "auto_approved" : "approved", payload: { candidateId, targetId: result.appliedTargetId },
  });
  return result;
}

export async function reviewMemoryCandidate(candidateId: string, decision: "approve" | "reject", reviewerId: string, note?: string) {
  const candidate = await db.memoryCandidate.findUniqueOrThrow({ where: { id: candidateId } });
  await requireAdaptiveScope({ actorUserId: reviewerId, organizationId: candidate.organizationId,
    workspaceId: candidate.workspaceId, projectId: candidate.projectId, userId: candidate.userId,
    permission: "knowledge.approve" });
  if (candidate.status !== "pending" && candidate.status !== "quarantined") {
    throw new Error(`Candidate is ${candidate.status}, not reviewable.`);
  }
  if (decision === "approve") {
    if (candidate.status === "quarantined" && !note?.trim()) throw new Error("A review note is required to release quarantined content.");
    if (candidate.status === "quarantined") await db.memoryCandidate.update({ where: { id: candidateId }, data: { status: "pending", reviewNote: note } });
    return promoteMemoryCandidate(candidateId, reviewerId);
  }
  const rejected = await db.memoryCandidate.update({ where: { id: candidateId }, data: {
    status: "rejected", reviewedBy: reviewerId, reviewNote: note, resolvedAt: new Date(),
  }});
  await writeAuditLog({ workspaceId: candidate.workspaceId, projectId: candidate.projectId,
    userId: reviewerId, action: "memory.rejected", entityType: "memoryCandidate",
    entityId: candidateId, details: { note: note ?? null },
  });
  await emitAdaptiveEvent({ type: "memory.rejected", userId: reviewerId,
    workspaceId: candidate.workspaceId ?? undefined, projectId: candidate.projectId ?? undefined,
    payload: { candidateId } });
  return rejected;
}

export async function rollbackMemoryCandidate(candidateId: string, actorUserId: string, reason: string) {
  const candidate = await db.memoryCandidate.findUniqueOrThrow({ where: { id: candidateId } });
  await requireAdaptiveScope({ actorUserId, workspaceId: candidate.workspaceId, projectId: candidate.projectId,
    userId: candidate.userId, permission: "knowledge.approve" });
  if (!candidate.appliedTargetId || !["approved", "auto_approved"].includes(candidate.status)) throw new Error("Candidate has no active promotion to roll back.");
  await db.$transaction(async (tx) => {
    if (candidate.appliedTargetType === "knowledge_object") {
      await tx.knowledgeObject.update({ where: { id: candidate.appliedTargetId! }, data: { validTo: new Date(), changeReason: `rollback:${reason}`, changedBy: actorUserId } });
    } else if (candidate.appliedTargetType === "knowledge_edge") {
      await tx.knowledgeEdge.update({ where: { id: candidate.appliedTargetId! }, data: { validTo: new Date(), changeReason: `rollback:${reason}`, changedBy: actorUserId } });
    }
    await tx.memoryCandidate.update({ where: { id: candidateId }, data: { status: "rolled_back", rolledBackAt: new Date(), reviewNote: reason } });
  });
  await writeAuditLog({ workspaceId: candidate.workspaceId, projectId: candidate.projectId, userId: actorUserId,
    action: "memory.rolled_back", entityType: "memoryCandidate", entityId: candidateId, details: { reason },
  });
  return db.memoryCandidate.findUniqueOrThrow({ where: { id: candidateId } });
}

export async function expireMemoryCandidates(now = new Date()) {
  const expiring = await db.memoryCandidate.findMany({ where: { expiresAt: { lte: now }, status: { in: ["pending", "quarantined"] } } });
  if (!expiring.length) return { expired: 0 };
  await db.memoryCandidate.updateMany({ where: { id: { in: expiring.map((item) => item.id) } }, data: { status: "expired", resolvedAt: now } });
  for (const candidate of expiring) await emitAdaptiveEvent({ type: "memory.expired", workspaceId: candidate.workspaceId ?? undefined, projectId: candidate.projectId ?? undefined, payload: { candidateId: candidate.id } });
  return { expired: expiring.length };
}

export function listMemoryCandidates(filter: { workspaceId?: string; projectId?: string; userId?: string; status?: string } = {}) {
  return db.memoryCandidate.findMany({ where: filter, orderBy: { createdAt: "desc" }, take: 200 });
}
