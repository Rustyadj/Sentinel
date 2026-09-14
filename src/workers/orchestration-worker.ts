import { Worker } from "bullmq";
import { db } from "@/lib/db";
import { executeOrchestrationRun } from "@/lib/orchestration/executor";
import { ORCHESTRATION_QUEUE_NAME, ORCHESTRATION_JOB_OPTIONS, type OrchestrationJobPayload } from "@/lib/orchestration/queue";

const redisUrl = process.env.REDIS_URL;
if (!redisUrl) throw new Error("REDIS_URL is required for the orchestration worker.");

const worker = new Worker<OrchestrationJobPayload>(ORCHESTRATION_QUEUE_NAME, async (job) => executeOrchestrationRun(job.data.runId), {
  connection: { url: redisUrl, maxRetriesPerRequest: null },
  concurrency: Number(process.env.ORCHESTRATION_WORKER_CONCURRENCY ?? "1"),
});

worker.on("failed", async (job, error) => {
  if (!job) return;
  const exhausted = job.attemptsMade >= (job.opts.attempts ?? ORCHESTRATION_JOB_OPTIONS.attempts ?? 1);
  await db.orchestrationRun.updateMany({
    where: { id: job.data.runId, status: { not: "cancelled" } },
    data: exhausted ? { status: "failed", error: error.message, completedAt: new Date() } : { status: "queued", error: error.message },
  });
});

async function shutdown() {
  await worker.close();
  await db.$disconnect();
}
process.once("SIGTERM", () => void shutdown());
process.once("SIGINT", () => void shutdown());
