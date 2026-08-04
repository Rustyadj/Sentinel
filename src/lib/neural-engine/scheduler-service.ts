import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import {
  runDegradationSweep,
  type DegradationSweepResult,
} from "./degradation-service";

export const DEGRADATION_SWEEP_JOB_KEY = "degradation-sweep";

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
