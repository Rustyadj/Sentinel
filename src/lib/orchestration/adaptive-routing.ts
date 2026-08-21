import { db } from "@/lib/db";
import type { AgentCapabilityKey } from "./capabilities";

/** Below this many comparable historical records, a candidate's track
 *  record is too thin to act on — the static capability weight stands
 *  alone rather than being nudged by a handful of early outcomes. */
const MIN_SAMPLES_FOR_ADJUSTMENT = 3;
/** How far historical success rate alone can move a score, either
 *  direction — bounded deliberately small so it nudges the existing
 *  capability-weight scoring rather than overriding it. */
const MAX_ADJUSTMENT = 0.15;
const HISTORY_WINDOW = 20;

export interface RecordOutcomeInput {
  chatRoomId: string;
  taskId: string;
  agentId: string;
  capabilities: string[];
  success: boolean;
  reviewCycles?: number;
  /** Rough wall-clock duration since the task was created — a coarse proxy, not a precise execution timer. */
  durationMs?: number;
}

/** Records one task's final outcome (COMPLETED or FAILED only — never an
 *  intermediate review cycle) so future routing decisions can weigh a
 *  worker's actual track record on similar work. */
export async function recordExecutionOutcome(input: RecordOutcomeInput): Promise<void> {
  await db.taskExecutionRecord.create({
    data: {
      chatRoomId: input.chatRoomId,
      taskId: input.taskId,
      agentId: input.agentId,
      capabilities: input.capabilities,
      success: input.success,
      reviewCycles: input.reviewCycles ?? 0,
      durationMs: input.durationMs,
    },
  });
}

/**
 * A small, bounded, explainable nudge to selectWorker()'s score — not an
 * ML model. Looks at this agent's most recent outcomes on tasks sharing
 * at least one required capability (or, with no capabilities specified,
 * its most recent outcomes overall), and returns a signed adjustment
 * proportional to how far its success rate sits from a neutral 50%.
 * Returns 0 below the minimum sample size.
 */
export async function historicalSuccessAdjustment(agentId: string, capabilities: AgentCapabilityKey[]): Promise<number> {
  const records = await db.taskExecutionRecord.findMany({
    where: { agentId, ...(capabilities.length ? { capabilities: { hasSome: capabilities } } : {}) },
    orderBy: { createdAt: "desc" },
    take: HISTORY_WINDOW,
  });
  if (records.length < MIN_SAMPLES_FOR_ADJUSTMENT) return 0;
  const successRate = records.filter((record) => record.success).length / records.length;
  return (successRate - 0.5) * (MAX_ADJUSTMENT * 2);
}

export interface AgentRoutingStats {
  agentId: string;
  sampleSize: number;
  successRate: number | null;
  averageDurationMs: number | null;
  averageReviewCycles: number | null;
}

/** Read-only aggregate stats for one agent — backs the getRoutingHistory tool and any future UI. */
export async function getAgentRoutingStats(agentId: string): Promise<AgentRoutingStats> {
  const records = await db.taskExecutionRecord.findMany({ where: { agentId }, orderBy: { createdAt: "desc" }, take: HISTORY_WINDOW });
  if (!records.length) return { agentId, sampleSize: 0, successRate: null, averageDurationMs: null, averageReviewCycles: null };
  const durations = records.map((r) => r.durationMs).filter((d): d is number => d !== null);
  return {
    agentId,
    sampleSize: records.length,
    successRate: records.filter((r) => r.success).length / records.length,
    averageDurationMs: durations.length ? Math.round(durations.reduce((sum, d) => sum + d, 0) / durations.length) : null,
    averageReviewCycles: Math.round((records.reduce((sum, r) => sum + r.reviewCycles, 0) / records.length) * 10) / 10,
  };
}
