import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import {
  runDegradationSweep,
  type DegradationSweepResult,
} from "./degradation-service";
import { runMemoryDecaySweep, type DecaySweepResult } from "@/lib/learning/memory-governance";
import { decayStaleTrust, type TrustDecayResult } from "@/lib/learning/trust";

export const DEGRADATION_SWEEP_JOB_KEY = "degradation-sweep";
export const MEMORY_DECAY_SWEEP_JOB_KEY = "memory-decay-sweep";
export const TRUST_DECAY_SWEEP_JOB_KEY = "trust-decay-sweep";

export interface RecordedDegradationSweep {
  jobRunId: string;
  result: DegradationSweepResult;
}

/** Record any implemented scheduled job through one durable lifecycle. */
export async function runRecordedScheduledJob<T>(
  jobKey: string,
  run: () => Promise<T>,
): Promise<{ jobRunId: string; result: T }> {
  const jobRun = await db.scheduledJobRun.create({
    data: { jobKey, status: "running" },
  });

  try {
    const result = await run();
    await db.scheduledJobRun.update({
      where: { id: jobRun.id },
      data: {
        status: "completed",
        completedAt: new Date(),
        result: (result ?? null) as unknown as Prisma.InputJsonValue,
        error: null,
      },
    });
    return { jobRunId: jobRun.id, result };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await db.scheduledJobRun.update({
      where: { id: jobRun.id },
      data: { status: "failed", completedAt: new Date(), error: message },
    });
    throw error;
  }
}

/**
 * Durable execution boundary for the externally-triggered degradation job.
 * Scheduling remains outside this process; every invocation is recorded so a
 * future queue worker can reuse the same service without changing semantics.
 */
export async function runRecordedDegradationSweep(): Promise<RecordedDegradationSweep> {
  return runRecordedScheduledJob(DEGRADATION_SWEEP_JOB_KEY, runDegradationSweep);
}

/**
 * Governed memory forgetting's decay sweep — same externally-triggered,
 * durably-recorded convention as the degradation sweep above. See
 * docs/LEARNING_CORE_EVOLUTION.md.
 */
export async function runRecordedMemoryDecaySweep(): Promise<{ jobRunId: string; result: DecaySweepResult }> {
  return runRecordedScheduledJob(MEMORY_DECAY_SWEEP_JOB_KEY, () => runMemoryDecaySweep({}));
}

/** Capability-specific trust decay's sweep — same convention. */
export async function runRecordedTrustDecaySweep(): Promise<{ jobRunId: string; result: TrustDecayResult }> {
  return runRecordedScheduledJob(TRUST_DECAY_SWEEP_JOB_KEY, () => decayStaleTrust());
}
