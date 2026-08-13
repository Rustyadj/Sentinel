// Governed Evolutionary Self-Improvement — graph integration.
//
// Reuses the canonical Sentinel graph (KnowledgeObject / KnowledgeEdge) via
// the existing knowledge-bridge helper. This file intentionally does not
// define a second graph, a second node table, or a second edge table — the
// spec explicitly forbids that ("Use the canonical Sentinel graph... Do not
// build a separate Learning graph"). It only adds the vocabulary (node
// `type`s, edge `type`s) new evolutionary entities need, in
// src/lib/knowledge/types.ts, and provides thin idempotent wrappers here so
// every new service (evolution, eval-compiler, guardian, principles,
// adversarial) links its rows into the same graph the Neural Lens already
// renders.

import { db } from "@/lib/db";
import type { Prisma } from "@prisma/client";
import { getOrCreateKnowledgeObjectForSource } from "@/lib/neural-engine/knowledge-bridge";
import type { KnowledgeObjectType, KnowledgeEdgeType, KnowledgeScope } from "@/lib/knowledge/types";

export interface SyncLearningObjectInput {
  type: KnowledgeObjectType;
  sourceType: string;
  sourceId: string;
  title: string;
  summary?: string;
  scope?: KnowledgeScope;
  workspaceId?: string | null;
  projectId?: string | null;
  userId?: string | null;
  metadata?: Record<string, unknown>;
}

/** Idempotent — a second call for the same (sourceType, sourceId) is a no-op create-wise. */
export async function syncLearningObject(input: SyncLearningObjectInput): Promise<string> {
  return getOrCreateKnowledgeObjectForSource({
    type: input.type,
    title: input.title,
    summary: input.summary,
    sourceType: input.sourceType,
    sourceId: input.sourceId,
    scope: input.scope ?? "workspace",
    projectId: input.projectId ?? null,
    userId: input.userId ?? null,
    metadata: input.metadata ?? {},
  });
}

function toJson(value: unknown): Prisma.InputJsonValue {
  return (value ?? {}) as Prisma.InputJsonValue;
}

/**
 * Create-or-strengthen a typed edge between two already-bridged
 * KnowledgeObject ids. Never emits a KnowledgeEvent itself — callers that
 * want graph-change notifications already emit their own domain event
 * (learning.*, guardian.*, ...) and a second generic one here would just be
 * noise for something the Neural Lens graph query picks up directly.
 */
export async function linkLearningEdge(
  fromObjectId: string,
  toObjectId: string,
  type: KnowledgeEdgeType,
  options: { weight?: number; metadata?: Record<string, unknown>; changeReason?: string } = {},
) {
  if (fromObjectId === toObjectId) return null;
  const existing = await db.knowledgeEdge.findUnique({
    where: { fromObjectId_toObjectId_type: { fromObjectId, toObjectId, type } },
  });
  if (existing) {
    return db.knowledgeEdge.update({
      where: { id: existing.id },
      data: {
        weight: options.weight ?? existing.weight,
        metadata: options.metadata ? toJson(options.metadata) : undefined,
        version: { increment: 1 },
        changeReason: options.changeReason ?? existing.changeReason,
      },
    });
  }
  return db.knowledgeEdge.create({
    data: {
      fromObjectId,
      toObjectId,
      type,
      weight: options.weight ?? 1,
      metadata: toJson(options.metadata ?? {}),
      changeReason: options.changeReason ?? null,
    },
  });
}

// --- Convenience wrappers for the entities this pass adds --------------

export function syncCandidateNode(candidate: {
  id: string;
  type: string;
  survivalStatus: string;
  problem: string | null;
  championGroup: string | null;
  workspaceId?: string | null;
}) {
  return syncLearningObject({
    type: "LearningCandidate",
    sourceType: "learning_candidate",
    sourceId: candidate.id,
    title: candidate.problem ?? `${candidate.type} candidate`,
    scope: "workspace",
    workspaceId: candidate.workspaceId ?? null,
    metadata: { survivalStatus: candidate.survivalStatus, championGroup: candidate.championGroup },
  });
}

export function syncEvalCaseNode(evalCase: {
  id: string;
  failureType: string;
  severity: string;
  workspaceId: string | null;
}) {
  return syncLearningObject({
    type: "EvalCase",
    sourceType: "eval_case",
    sourceId: evalCase.id,
    title: `Regression: ${evalCase.failureType}`,
    scope: "workspace",
    workspaceId: evalCase.workspaceId,
    metadata: { severity: evalCase.severity },
  });
}

export function syncEvalSuiteNode(suite: { id: string; name: string; category: string; workspaceId: string | null }) {
  return syncLearningObject({
    type: "EvalSuite",
    sourceType: "eval_suite",
    sourceId: suite.id,
    title: suite.name,
    scope: "workspace",
    workspaceId: suite.workspaceId,
    metadata: { category: suite.category },
  });
}

export function syncGuardianDecisionNode(decision: {
  id: string;
  action: string;
  guardianDecision: string;
  tier: number;
  workspaceId: string | null;
}) {
  return syncLearningObject({
    type: "GuardianDecision",
    sourceType: "guardian_decision",
    sourceId: decision.id,
    title: `Guardian: ${decision.action}`,
    scope: "workspace",
    workspaceId: decision.workspaceId,
    metadata: { decision: decision.guardianDecision, tier: decision.tier },
  });
}

export function syncPrincipleNode(principle: {
  id: string;
  statement: string;
  domain: string | null;
  workspaceId: string | null;
}) {
  return syncLearningObject({
    type: "Principle",
    sourceType: "principle",
    sourceId: principle.id,
    title: principle.statement.slice(0, 120),
    scope: "workspace",
    workspaceId: principle.workspaceId,
    metadata: { domain: principle.domain },
  });
}

export function syncAdversarialRunNode(run: {
  id: string;
  attackType: string;
  outcome: string;
  workspaceId: string | null;
}) {
  return syncLearningObject({
    type: "AdversarialRun",
    sourceType: "adversarial_run",
    sourceId: run.id,
    title: `Adversarial: ${run.attackType}`,
    scope: "workspace",
    workspaceId: run.workspaceId,
    metadata: { outcome: run.outcome },
  });
}
