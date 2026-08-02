import { db } from "@/lib/db";
import { ALWAYS_HIGH_RISK_TYPES, type LearningCandidateType } from "@/lib/neural-engine/types";

/** Trust changes are percentage points; AgentCompetency stores 0–1. */
export const TRUST_EVENT_DELTAS = {
  benchmark_improvement: 3,
  candidate_applied: 2,
  stable_production_period: 1,
  user_override: -2,
  approval_rejection: -2,
  candidate_failed_or_rolled_back: -4,
  safety_or_policy_violation: -10,
} as const;

export type TrustEventType = keyof typeof TRUST_EVENT_DELTAS;

export interface RecordTrustEventInput {
  agentId: string;
  domain: string;
  eventType: TrustEventType;
  reason: string;
  traceId?: string | null;
  candidateId?: string | null;
}

export interface TrustAutomationEligibilityInput {
  competencyScore: number;
  riskTier: 1 | 2 | 3;
  candidateType?: LearningCandidateType;
}

export const TRUST_AUTOMATION_MIN_SCORE = 0.8;

/**
 * Record one capability-specific trust delta and update its domain snapshot.
 * No write can spill into another domain because the unique upsert key is
 * always the normalized `[agentId, domain]` pair.
 */
export async function recordTrustEvent(input: RecordTrustEventInput) {
  const agentId = input.agentId.trim();
  const domain = normalizeTrustDomain(input.domain);
  const reason = input.reason.trim();
  if (!agentId || !domain || !reason) {
    throw new Error("agentId, domain, and reason are required");
  }

  const delta = TRUST_EVENT_DELTAS[input.eventType];
  if (delta === undefined) {
    throw new Error(`Unsupported trust event type: ${input.eventType}`);
  }

  const lockKey = `agent-trust:${agentId}:${domain}`;
  return db.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${lockKey})) IS NULL AS locked`;
    const current = await tx.agentCompetency.findUnique({
      where: { agentId_domain: { agentId, domain } },
    });
    const evidenceCount = current?.evidenceCount ?? 0;
    const succeeded = delta > 0;
    const priorSuccesses = (current?.successRate ?? 0) * evidenceCount;
    const nextEvidenceCount = evidenceCount + 1;
    const competency = await tx.agentCompetency.upsert({
      where: { agentId_domain: { agentId, domain } },
      create: {
        agentId,
        domain,
        score: clampScore(0.5 + delta / 100),
        evidenceCount: 1,
        successRate: succeeded ? 1 : 0,
        lastEvaluatedAt: new Date(),
      },
      update: {
        score: clampScore((current?.score ?? 0.5) + delta / 100),
        evidenceCount: nextEvidenceCount,
        successRate: (priorSuccesses + (succeeded ? 1 : 0)) / nextEvidenceCount,
        lastEvaluatedAt: new Date(),
      },
    });
    const event = await tx.trustEvent.create({
      data: {
        agentId,
        domain,
        eventType: input.eventType,
        delta,
        reason,
        traceId: input.traceId ?? null,
        candidateId: input.candidateId ?? null,
      },
    });
    return { event, competency };
  });
}

export async function getAgentTrustProfile(agentId: string, historyLimit = 100) {
  const normalizedAgentId = agentId.trim();
  if (!normalizedAgentId) throw new Error("agentId is required");

  const [domains, recentEvents] = await Promise.all([
    db.agentCompetency.findMany({
      where: { agentId: normalizedAgentId },
      orderBy: { domain: "asc" },
    }),
    db.trustEvent.findMany({
      where: { agentId: normalizedAgentId },
      orderBy: { createdAt: "desc" },
      take: Math.min(Math.max(historyLimit, 1), 250),
    }),
  ]);
  return { agentId: normalizedAgentId, domains, recentEvents };
}

/**
 * Trust can make low-risk automation eligible; it never grants permission.
 * Tier 3 and protected candidate surfaces are denied here before score is
 * considered and must continue through their normal authorization/approval
 * paths. Callers still have to perform those checks for every eligible action.
 */
export function evaluateTrustAutomationEligibility(
  input: TrustAutomationEligibilityInput,
): { eligible: boolean; reason: string } {
  if (input.riskTier === 3) {
    return { eligible: false, reason: "Tier 3 operations always require explicit authorization." };
  }
  if (input.candidateType && ALWAYS_HIGH_RISK_TYPES.has(input.candidateType)) {
    return {
      eligible: false,
      reason: `Protected candidate type "${input.candidateType}" can never be authorized by trust.`,
    };
  }
  const score = clampScore(input.competencyScore);
  return score >= TRUST_AUTOMATION_MIN_SCORE
    ? { eligible: true, reason: "Domain trust meets the low-risk automation threshold." }
    : { eligible: false, reason: "Domain trust is below the automation threshold." };
}

export function normalizeTrustDomain(domain: string): string {
  return domain.trim().toLowerCase().replace(/\s+/g, "_");
}

function clampScore(score: number): number {
  return Math.round(Math.min(1, Math.max(0, score)) * 1000) / 1000;
}
