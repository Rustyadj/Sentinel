import { Worker } from "bullmq";
import { db } from "@/lib/db";
import { executeOrchestrationRun, reconcileUnconfirmedInterruptions } from "@/lib/orchestration/executor";
import { orchestrationWorkerId } from "@/lib/orchestration/execution-ownership";
import { ORCHESTRATION_QUEUE_NAME, ORCHESTRATION_JOB_OPTIONS, type OrchestrationJobPayload } from "@/lib/orchestration/queue";
import { QUEUE_PREFIX } from "@/lib/queue-prefix";

const redisUrl = process.env.REDIS_URL;
if (!redisUrl) throw new Error("REDIS_URL is required for the orchestration worker.");

const workerId = orchestrationWorkerId();
const worker = new Worker<OrchestrationJobPayload>(ORCHESTRATION_QUEUE_NAME, async (job) => executeOrchestrationRun(job.data.runId, workerId), {
  connection: { url: redisUrl, maxRetriesPerRequest: null },
  // Must match the queue side, or this worker silently consumes nothing.
  prefix: QUEUE_PREFIX,
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

// Sessions the runtime never confirmed stopped stay open until a later check gets that confirmation.
const reconciler = setInterval(() => { void reconcileUnconfirmedInterruptions().catch((error) => console.error("[orchestration-worker] reconcile failed", error instanceof Error ? error.message : error)); }, 60_000);
reconciler.unref();

async function shutdown() {
  clearInterval(reconciler);
  await worker.close();
  await db.$disconnect();
}
process.once("SIGTERM", () => void shutdown());
process.once("SIGINT", () => void shutdown());
