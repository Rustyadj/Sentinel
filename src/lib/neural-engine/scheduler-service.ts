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

/**
 * Durable execution boundary for the externally-triggered degradation job.
 * Scheduling remains outside this process; every invocation is recorded so a
 * future queue worker can reuse the same service without changing semantics.
 */
export async function runRecordedDegradationSweep(): Promise<RecordedDegradationSweep> {
  const jobRun = await db.scheduledJobRun.create({
    data: { jobKey: DEGRADATION_SWEEP_JOB_KEY, status: "running" },
  });

  try {
    const result = await runDegradationSweep();
    await db.scheduledJobRun.update({
      where: { id: jobRun.id },
      data: {
        status: "completed",
        completedAt: new Date(),
        result: result as unknown as Prisma.InputJsonValue,
        error: null,
      },
    });
    return { jobRunId: jobRun.id, result };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await db.scheduledJobRun.update({
      where: { id: jobRun.id },
      data: {
        status: "failed",
        completedAt: new Date(),
        error: message,
      },
    });
    throw error;
  }
}
