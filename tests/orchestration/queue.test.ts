import { afterEach, describe, expect, it } from "vitest";
import { closeOrchestrationQueue, enqueueOrchestrationRun, getOrchestrationQueue, ORCHESTRATION_JOB_OPTIONS } from "@/lib/orchestration/queue";

afterEach(async () => { await closeOrchestrationQueue(); });

describe("orchestration BullMQ queue", () => {
  it("persists one idempotent durable run job with bounded retry policy", async () => {
    const runId = `queue-${Date.now()}-${Math.random().toString(16).slice(2)}`;
    await enqueueOrchestrationRun(runId);
    const job = await getOrchestrationQueue()!.getJob(runId);
    expect(job?.data).toEqual({ runId });
    expect(job?.opts).toMatchObject({ attempts: ORCHESTRATION_JOB_OPTIONS.attempts, backoff: ORCHESTRATION_JOB_OPTIONS.backoff });
    await job?.remove();
  });
});
