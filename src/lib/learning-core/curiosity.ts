import { db } from "@/lib/db";
import type { Prisma } from "@prisma/client";
import { syncCuriosityEventToGraph } from "./graph";

// Threshold above which an agent should ask instead of guess. Kept as a
// plain constant for now — becomes a FeatureFlag-tunable value once Codex's
// FeatureFlagService lands.
export const CURIOSITY_THRESHOLD = 0.6;

export interface CuriosityFactors {
  confidence?: number;
  missingInfo?: boolean;
  contradictoryMemories?: boolean;
  toolFailures?: number;
  unknownTerminology?: boolean;
  unusualRequest?: boolean;
  missingGoal?: boolean;
  conflictingConstraints?: boolean;
  unexpectedOutcome?: boolean;
}

const FACTOR_WEIGHTS: Record<keyof CuriosityFactors, number> = {
  confidence: 0.35, // (1 - confidence) contribution
  missingInfo: 0.15,
  contradictoryMemories: 0.15,
  toolFailures: 0.1,
  unknownTerminology: 0.1,
  unusualRequest: 0.05,
  missingGoal: 0.15,
  conflictingConstraints: 0.15,
  unexpectedOutcome: 0.1,
};

export function computeCuriosityScore(factors: CuriosityFactors): number {
  let score = 0;
  if (factors.confidence !== undefined) {
    score += (1 - Math.min(Math.max(factors.confidence, 0), 1)) * FACTOR_WEIGHTS.confidence;
  }
  if (factors.missingInfo) score += FACTOR_WEIGHTS.missingInfo;
  if (factors.contradictoryMemories) score += FACTOR_WEIGHTS.contradictoryMemories;
  if (factors.toolFailures) score += Math.min(factors.toolFailures * 0.05, FACTOR_WEIGHTS.toolFailures);
  if (factors.unknownTerminology) score += FACTOR_WEIGHTS.unknownTerminology;
  if (factors.unusualRequest) score += FACTOR_WEIGHTS.unusualRequest;
  if (factors.missingGoal) score += FACTOR_WEIGHTS.missingGoal;
  if (factors.conflictingConstraints) score += FACTOR_WEIGHTS.conflictingConstraints;
  if (factors.unexpectedOutcome) score += FACTOR_WEIGHTS.unexpectedOutcome;
  return Math.min(Math.round(score * 100) / 100, 1);
}

export async function recordCuriosityEvent(input: {
  agentId: string;
  factors: CuriosityFactors;
  triggerContext?: string;
  question?: string;
}) {
  const score = computeCuriosityScore(input.factors);
  const event = await db.curiosityEvent.create({
    data: {
      agentId: input.agentId,
      score,
      factors: input.factors as unknown as Prisma.InputJsonValue,
      triggerContext: input.triggerContext ?? null,
      question: score >= CURIOSITY_THRESHOLD ? (input.question ?? null) : null,
    },
  });
  await syncCuriosityEventToGraph(event);
  return event;
}

export async function resolveCuriosityEvent(id: string, resolution: string) {
  const event = await db.curiosityEvent.update({
    where: { id },
    data: { resolved: true, resolution },
  });
  await syncCuriosityEventToGraph(event);
  return event;
}

export async function listCuriosityEvents(params?: { agentId?: string; unresolvedOnly?: boolean; limit?: number }) {
  return db.curiosityEvent.findMany({
    where: {
      ...(params?.agentId ? { agentId: params.agentId } : {}),
      ...(params?.unresolvedOnly ? { resolved: false } : {}),
    },
    include: { agent: { select: { id: true, name: true, avatar: true, color: true } } },
    orderBy: { createdAt: "desc" },
    take: params?.limit ?? 50,
  });
}
