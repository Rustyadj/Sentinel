// Sentinel Neural Engine — Agent State Graph (Layer 4)
//
// Each agent gets a scoped view over the canonical graph: a profile, per-
// domain competency scores, and per-object trust/relevance weights. This is
// NOT a separate physical database per agent — it's rows scoped by agentId
// over the same Postgres instance.

import { db } from "@/lib/db";
import type { Prisma } from "@prisma/client";

function toJson(value: unknown): Prisma.InputJsonValue {
  return (value ?? {}) as Prisma.InputJsonValue;
}

export async function getOrCreateAgentProfile(agentId: string) {
  const existing = await db.agentKnowledgeProfile.findUnique({ where: { agentId } });
  if (existing) return existing;
  return db.agentKnowledgeProfile.create({ data: { agentId } });
}

export async function updateAgentProfile(
  agentId: string,
  updates: Partial<{
    retrievalWeights: Record<string, unknown>;
    preferredSources: string[];
    trustThresholds: Record<string, unknown>;
    memoryScopes: string[];
    privateGraphScope: string;
  }>,
) {
  await getOrCreateAgentProfile(agentId);
  return db.agentKnowledgeProfile.update({
    where: { agentId },
    data: {
      ...(updates.retrievalWeights ? { retrievalWeights: toJson(updates.retrievalWeights) } : {}),
      ...(updates.preferredSources ? { preferredSources: updates.preferredSources } : {}),
      ...(updates.trustThresholds ? { trustThresholds: toJson(updates.trustThresholds) } : {}),
      ...(updates.memoryScopes ? { memoryScopes: updates.memoryScopes } : {}),
      ...(updates.privateGraphScope ? { privateGraphScope: updates.privateGraphScope } : {}),
    },
  });
}

/**
 * Update a domain competency using a simple running-average blend weighted
 * by prior evidence count, then bump evidenceCount. This is intentionally a
 * plain incremental estimator for Phase A — a proper Bayesian/decay model is
 * Phase E (competency tracking) territory.
 */
export async function recordCompetencyEvidence(
  agentId: string,
  domain: string,
  observedScore: number,
  succeeded: boolean,
) {
  const existing = await db.agentCompetency.findUnique({
    where: { agentId_domain: { agentId, domain } },
  });

  if (!existing) {
    return db.agentCompetency.create({
      data: {
        agentId,
        domain,
        score: observedScore,
        evidenceCount: 1,
        successRate: succeeded ? 1 : 0,
        lastEvaluatedAt: new Date(),
      },
    });
  }

  const n = existing.evidenceCount;
  const blendedScore = (existing.score * n + observedScore) / (n + 1);
  const successes = existing.successRate * n + (succeeded ? 1 : 0);

  return db.agentCompetency.update({
    where: { agentId_domain: { agentId, domain } },
    data: {
      score: blendedScore,
      evidenceCount: n + 1,
      successRate: successes / (n + 1),
      lastEvaluatedAt: new Date(),
    },
  });
}

export async function listAgentCompetencies(agentId: string) {
  return db.agentCompetency.findMany({ where: { agentId }, orderBy: { domain: "asc" } });
}

/**
 * Strengthen or weaken an agent's trust/relevance weight for a specific
 * KnowledgeObject based on an outcome. This is the mechanism behind
 * "prior success strengthening" / "prior failure weakening" in the learning
 * loop. Bounded to [0, 1].
 */
export async function adjustKnowledgeWeight(
  agentId: string,
  knowledgeObjectId: string,
  outcome: "success" | "failure",
  magnitude = 0.1,
) {
  const existing = await db.agentKnowledgeWeight.findUnique({
    where: { agentId_knowledgeObjectId: { agentId, knowledgeObjectId } },
  });

  const clamp = (v: number) => Math.max(0, Math.min(1, v));

  if (!existing) {
    return db.agentKnowledgeWeight.create({
      data: {
        agentId,
        knowledgeObjectId,
        relevanceWeight: 0.5,
        trustWeight: clamp(0.5 + (outcome === "success" ? magnitude : -magnitude)),
        successWeight: outcome === "success" ? magnitude : 0,
        failureWeight: outcome === "failure" ? magnitude : 0,
        lastUsedAt: new Date(),
      },
    });
  }

  return db.agentKnowledgeWeight.update({
    where: { agentId_knowledgeObjectId: { agentId, knowledgeObjectId } },
    data: {
      trustWeight: clamp(
        existing.trustWeight + (outcome === "success" ? magnitude : -magnitude),
      ),
      successWeight:
        outcome === "success" ? clamp(existing.successWeight + magnitude) : existing.successWeight,
      failureWeight:
        outcome === "failure" ? clamp(existing.failureWeight + magnitude) : existing.failureWeight,
      lastUsedAt: new Date(),
    },
  });
}

export async function listAgentKnowledgeWeights(agentId: string, limit = 100) {
  return db.agentKnowledgeWeight.findMany({
    where: { agentId },
    orderBy: { lastUsedAt: "desc" },
    take: limit,
  });
}
