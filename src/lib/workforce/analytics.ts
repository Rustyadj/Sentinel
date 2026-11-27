export interface RecordedStep {
  status: string;
  attempts: number;
  actualCostCents: number;
  estimatedCostCents: number;
  startedAt: Date | null;
  completedAt: Date | null;
}

export function summarizeRecordedSteps(steps: readonly RecordedStep[]) {
  let completed = 0;
  let failed = 0;
  let completedAfterRetry = 0;
  let recordedCostCents = 0;
  let estimatedCostCents = 0;
  let durationMs = 0;
  let timed = 0;
  for (const step of steps) {
    recordedCostCents += step.actualCostCents;
    estimatedCostCents += step.estimatedCostCents;
    if (step.status === "failed") failed++;
    if (step.status !== "completed") continue;
    completed++;
    if (step.attempts > 1) completedAfterRetry++;
    if (step.startedAt && step.completedAt && step.completedAt >= step.startedAt) {
      timed++;
      durationMs += step.completedAt.getTime() - step.startedAt.getTime();
    }
  }

  return {
    completed, failed, completedAfterRetry, recordedCostCents, estimatedCostCents,
    averageDurationMs: timed ? Math.round(durationMs / timed) : null,
    successRate: completed + failed ? completed / (completed + failed) : null,
  };
}
