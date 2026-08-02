import { afterAll, beforeAll, describe, expect, it } from "vitest";

beforeAll(() => {
  process.env.REDIS_URL ??= "redis://localhost:6379";
});

afterAll(async () => {
  const { closeLearningQueues } = await import("@/lib/learning/queue");
  await closeLearningQueues();
});

describe("release audit — BullMQ reliability", () => {
  it("persists bounded retry and exponential backoff on recurring jobs", async () => {
    const {
      JOB_NAMES,
      closeLearningQueues,
      getLearningQueue,
      scheduleRecurringJobs,
    } = await import("@/lib/learning/queue");
    await scheduleRecurringJobs();
    const schedulers = await getLearningQueue()!.getJobSchedulers(0, 20, true);
    const sweep = schedulers.find((scheduler) => scheduler.key === JOB_NAMES.degradationSweep);

    expect(sweep?.template?.opts).toMatchObject({
      attempts: 3,
      backoff: { type: "exponential", delay: 1_000 },
    });
    await closeLearningQueues();
  });
});
