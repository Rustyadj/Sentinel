// Principle distillation.
//
// Extends the Skill/Procedure family conceptually (see schema comment on
// Principle) but is a genuinely distinct, versioned model: a conditional
// behavioral rule with an evidence trail, not an executable step sequence
// and not another summarized-memory blob. Distillation only fires when
// evidence repeats, confidence clears a threshold, and no unresolved
// high-confidence contradiction exists — never from one anecdote.

import { db } from "@/lib/db";
import type { Prisma } from "@prisma/client";
import { emitLearningEvent } from "./event-service";
import { syncPrincipleNode, linkLearningEdge, syncLearningObject } from "./graph-sync";

export const MIN_EVIDENCE_COUNT_FOR_DISTILLATION = 3;
export const MIN_CONFIDENCE_FOR_DISTILLATION = 0.6;

export interface DistillPrincipleInput {
  statement: string;
  scope: "global" | "workspace" | "agent" | "domain";
  domain?: string;
  workspaceId?: string | null;
  agentId?: string | null;
  conditions?: unknown[];
  exceptions?: unknown[];
  /** Confidence in the underlying evidence, 0..1 — distinct from Principle.confidence, which factors in evidence count too. */
  evidenceConfidence: number;
  supportingExperienceIds: string[];
  contradictingExperienceIds?: string[];
  changeReason: string;
}

export interface DistillPrincipleResult {
  principle: Awaited<ReturnType<typeof db.principle.create>> | null;
  distilled: boolean;
  reasons: string[];
}

/**
 * Distill (or reinforce) a Principle from repeated evidence. Refuses when:
 *  - fewer than MIN_EVIDENCE_COUNT_FOR_DISTILLATION distinct supporting
 *    experiences are cited (one anecdote never becomes a global rule);
 *  - evidenceConfidence is below threshold;
 *  - contradicting evidence outweighs supporting evidence (an unresolved
 *    high-confidence contradiction blocks distillation rather than being
 *    silently outvoted).
 * A second call for a statement that already exists as an active Principle
 * in the same scope reinforces it (increments evidenceCount, merges
 * evidence ids) rather than creating a duplicate row.
 */
export async function distillPrinciple(input: DistillPrincipleInput): Promise<DistillPrincipleResult> {
  const supportingExperienceIds = [...new Set(input.supportingExperienceIds)];
  const contradictingExperienceIds = [...new Set(input.contradictingExperienceIds ?? [])];
  const reasons: string[] = [];

  if (supportingExperienceIds.length < MIN_EVIDENCE_COUNT_FOR_DISTILLATION) {
    reasons.push(
      `only ${supportingExperienceIds.length} distinct supporting experience(s) — needs at least ${MIN_EVIDENCE_COUNT_FOR_DISTILLATION}`,
    );
  }
  if (input.evidenceConfidence < MIN_CONFIDENCE_FOR_DISTILLATION) {
    reasons.push(`evidence confidence ${input.evidenceConfidence} below threshold ${MIN_CONFIDENCE_FOR_DISTILLATION}`);
  }
  if (contradictingExperienceIds.length >= supportingExperienceIds.length && contradictingExperienceIds.length > 0) {
    reasons.push(
      `${contradictingExperienceIds.length} contradicting experience(s) meet or exceed ${supportingExperienceIds.length} supporting — unresolved contradiction blocks distillation`,
    );
  }

  if (reasons.length > 0) {
    return { principle: null, distilled: false, reasons };
  }

  const existing = await db.principle.findFirst({
    where: {
      statement: input.statement,
      scope: input.scope,
      workspaceId: input.workspaceId ?? null,
      agentId: input.agentId ?? null,
      status: "active",
    },
  });

  if (existing) {
    const reinforced = await reinforcePrinciple(existing.id, {
      supportingExperienceIds,
      contradictingExperienceIds,
      evidenceConfidence: input.evidenceConfidence,
      changeReason: input.changeReason,
    });
    return { principle: reinforced, distilled: true, reasons: ["reinforced existing principle"] };
  }

  const principle = await db.$transaction(async (tx) => {
    const created = await tx.principle.create({
      data: {
        statement: input.statement,
        scope: input.scope,
        domain: input.domain ?? null,
        workspaceId: input.workspaceId ?? null,
        agentId: input.agentId ?? null,
        conditions: (input.conditions ?? []) as Prisma.InputJsonValue,
        exceptions: (input.exceptions ?? []) as Prisma.InputJsonValue,
        confidence: input.evidenceConfidence,
        evidenceCount: supportingExperienceIds.length,
        supportingExperienceIds,
        contradictingExperienceIds,
        currentVersion: 1,
        lastValidatedAt: new Date(),
      },
    });
    await tx.principleVersion.create({
      data: {
        principleId: created.id,
        version: 1,
        statement: created.statement,
        conditions: created.conditions as Prisma.InputJsonValue,
        exceptions: created.exceptions as Prisma.InputJsonValue,
        confidence: created.confidence,
        changeReason: input.changeReason,
        supportingExperienceIds,
        contradictingExperienceIds,
      },
    });
    return created;
  });

  const nodeId = await syncPrincipleNode(principle);
  for (const experienceId of supportingExperienceIds) {
    const experienceNodeId = await syncLearningObject({
      type: "Note",
      sourceType: "experience",
      sourceId: experienceId,
      title: `Experience ${experienceId}`,
      scope: "workspace",
      workspaceId: input.workspaceId ?? null,
    });
    await linkLearningEdge(nodeId, experienceNodeId, "distilled_from");
  }

  await emitLearningEvent({
    eventType: "principle_distilled",
    sourceType: "principle",
    sourceId: principle.id,
    workspaceId: input.workspaceId ?? undefined,
    payload: { statement: principle.statement, evidenceCount: principle.evidenceCount },
  }).catch(() => {});

  return { principle, distilled: true, reasons: [] };
}

async function reinforcePrinciple(
  principleId: string,
  update: {
    supportingExperienceIds: string[];
    contradictingExperienceIds: string[];
    evidenceConfidence: number;
    changeReason: string;
  },
) {
  const current = await db.principle.findUniqueOrThrow({ where: { id: principleId } });
  const mergedSupporting = [...new Set([...current.supportingExperienceIds, ...update.supportingExperienceIds])];
  const mergedContradicting = [...new Set([...current.contradictingExperienceIds, ...update.contradictingExperienceIds])];
  const confidence = Math.min(1, Math.round(((current.confidence + update.evidenceConfidence) / 2) * 1000) / 1000);

  return db.principle.update({
    where: { id: principleId },
    data: {
      confidence,
      evidenceCount: mergedSupporting.length,
      supportingExperienceIds: mergedSupporting,
      contradictingExperienceIds: mergedContradicting,
      lastValidatedAt: new Date(),
    },
  });
}

export interface EvolvePrincipleInput {
  principleId: string;
  statement?: string;
  conditions?: unknown[];
  exceptions?: unknown[];
  changeReason: string;
  confidence?: number;
  supportingExperienceIds?: string[];
  contradictingExperienceIds?: string[];
  actorId: string;
}

/**
 * Version a principle's behavior. Never overwrites in place — always
 * creates a new PrincipleVersion row and bumps currentVersion, so a
 * behavioral rule's history is fully reconstructable (spec: "Never silently
 * overwrite important behavioral principles").
 */
export async function evolvePrinciple(input: EvolvePrincipleInput) {
  const current = await db.principle.findUniqueOrThrow({ where: { id: input.principleId } });
  const nextVersion = current.currentVersion + 1;

  const updated = await db.$transaction(async (tx) => {
    const principle = await tx.principle.update({
      where: { id: input.principleId },
      data: {
        statement: input.statement ?? current.statement,
        conditions: input.conditions !== undefined ? (input.conditions as Prisma.InputJsonValue) : undefined,
        exceptions: input.exceptions !== undefined ? (input.exceptions as Prisma.InputJsonValue) : undefined,
        confidence: input.confidence ?? current.confidence,
        supportingExperienceIds: input.supportingExperienceIds ?? current.supportingExperienceIds,
        contradictingExperienceIds: input.contradictingExperienceIds ?? current.contradictingExperienceIds,
        currentVersion: nextVersion,
        lastValidatedAt: new Date(),
      },
    });
    await tx.principleVersion.create({
      data: {
        principleId: principle.id,
        version: nextVersion,
        statement: principle.statement,
        conditions: principle.conditions as Prisma.InputJsonValue,
        exceptions: principle.exceptions as Prisma.InputJsonValue,
        confidence: principle.confidence,
        changeReason: input.changeReason,
        supportingExperienceIds: principle.supportingExperienceIds,
        contradictingExperienceIds: principle.contradictingExperienceIds,
      },
    });
    return principle;
  });

  await emitLearningEvent({
    eventType: "principle_evolved",
    sourceType: "principle",
    sourceId: updated.id,
    userId: input.actorId,
    payload: { version: nextVersion, changeReason: input.changeReason },
  }).catch(() => {});

  return updated;
}

export async function retractPrinciple(principleId: string, actorId: string, reason: string) {
  const updated = await db.principle.update({
    where: { id: principleId },
    data: { status: "retracted" },
  });
  await emitLearningEvent({
    eventType: "principle_retracted",
    sourceType: "principle",
    sourceId: principleId,
    userId: actorId,
    payload: { reason },
  }).catch(() => {});
  return updated;
}

export async function listPrinciples(params: { domain?: string; workspaceId?: string; agentId?: string; status?: string } = {}) {
  return db.principle.findMany({
    where: {
      ...(params.domain ? { domain: params.domain } : {}),
      ...(params.workspaceId ? { workspaceId: params.workspaceId } : {}),
      ...(params.agentId ? { agentId: params.agentId } : {}),
      status: params.status ?? "active",
    },
    orderBy: { updatedAt: "desc" },
  });
}

export async function getPrincipleHistory(principleId: string) {
  return db.principleVersion.findMany({ where: { principleId }, orderBy: { version: "asc" } });
}
