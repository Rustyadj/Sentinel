import { db } from "@/lib/db";
import { syncTrustEventToGraph } from "./graph";

export const TRUST_EVENT_DELTAS = {
  benchmark_win: 3,
  approved_improvement: 5,
  accuracy: 1,
  failed_experiment: -1,
  user_override: -2,
  hallucination: -4,
  rollback: -8,
  unsafe_event: -15,
} as const;

export type TrustEventCategory = keyof typeof TRUST_EVENT_DELTAS;

const COUNTER_BY_CATEGORY = {
  benchmark_win: "benchmarkWins",
  approved_improvement: "approvedImprovements",
  failed_experiment: "failedExperiments",
  user_override: "overrides",
  hallucination: "hallucinations",
  rollback: "rollbackCount",
  unsafe_event: "unsafeEvents",
} as const;

export function getAutonomyDecision(score: number, approvalLevel: number) {
  if (approvalLevel === 3) {
    return { allowed: false, label: "Human approval required", reason: "Level 3 never auto-promotes" };
  }
  if (approvalLevel === 2) {
    return score >= 80
      ? { allowed: true, label: "Shadow auto-promotion eligible", reason: "Trust is at least 80" }
      : { allowed: false, label: "Human approval required", reason: "Level 2 requires trust of at least 80" };
  }
  return score >= 40
    ? { allowed: true, label: "Auto-deploy eligible", reason: "Trust is at least 40" }
    : { allowed: false, label: "Human approval required", reason: "Trust is below 40" };
}

export async function recordTrustEvent(input: {
  agentId: string;
  category: TrustEventCategory;
  reason: string;
}) {
  const delta = TRUST_EVENT_DELTAS[input.category];
  if (delta === undefined) throw new Error(`Unknown trust event category: ${input.category}`);

  const result = await db.$transaction(async (tx) => {
    const current = await tx.agentTrustScore.upsert({
      where: { agentId: input.agentId },
      create: { agentId: input.agentId },
      update: {},
    });
    const counter = COUNTER_BY_CATEGORY[input.category as keyof typeof COUNTER_BY_CATEGORY];
    const counterData = counter ? { [counter]: { increment: 1 } } : {};
    const benchmarkWins = current.benchmarkWins + (input.category === "benchmark_win" ? 1 : 0);
    const failedExperiments = current.failedExperiments + (input.category === "failed_experiment" ? 1 : 0);
    const denominator = benchmarkWins + failedExperiments;
    const score = await tx.agentTrustScore.update({
      where: { agentId: input.agentId },
      data: {
        score: Math.min(100, Math.max(0, current.score + delta)),
        accuracy: denominator === 0 ? 0 : benchmarkWins / denominator,
        ...counterData,
      },
    });
    const event = await tx.trustEvent.create({
      data: { agentId: input.agentId, delta, reason: input.reason, category: input.category },
    });
    return { score, event };
  });

  await syncTrustEventToGraph(result.event);
  return result;
}

export async function listTrustScores() {
  return db.agentTrustScore.findMany({
    include: { agent: { select: { id: true, name: true, avatar: true, color: true } } },
    orderBy: { score: "desc" },
  });
}

export async function listTrustEvents(params?: { agentId?: string; limit?: number }) {
  return db.trustEvent.findMany({
    where: params?.agentId ? { agentId: params.agentId } : {},
    include: { agent: { select: { id: true, name: true, avatar: true, color: true } } },
    orderBy: { createdAt: "desc" },
    take: params?.limit ?? 100,
  });
}

export async function getTrustCenter(agentId?: string) {
  const [scores, events] = await Promise.all([
    agentId
      ? db.agentTrustScore.findMany({
          where: { agentId },
          include: { agent: { select: { id: true, name: true, avatar: true, color: true } } },
        })
      : listTrustScores(),
    listTrustEvents({ agentId, limit: 100 }),
  ]);
  return { scores, events };
}

export async function getAgentTrustScore(agentId: string): Promise<number> {
  const trust = await db.agentTrustScore.findUnique({ where: { agentId } });
  return trust?.score ?? 50;
}
