import { Worker } from "bullmq";
import Redis from "ioredis";
import { db } from "@/lib/db";
import { executeOrchestrationRun, reconcileUnconfirmedInterruptions } from "@/lib/orchestration/executor";
import { retryBotContinuations } from "@/lib/bots/tasks";
import { orchestrationWorkerId } from "@/lib/orchestration/execution-ownership";
import { ORCHESTRATION_QUEUE_NAME, ORCHESTRATION_JOB_OPTIONS, type OrchestrationJobPayload } from "@/lib/orchestration/queue";
import { QUEUE_PREFIX } from "@/lib/queue-prefix";
import { executeRuntimeCall } from "@/lib/agents/runtime/execution-host";
import { REPLY_TTL_SECONDS, RUNTIME_CALL_QUEUE_NAME, replyStreamKey, type RuntimeCallPayload } from "@/lib/agents/runtime/remote-execution";
import { getLocalRuntimeAdapter, resolveRuntimeInstance } from "@/lib/agents/runtime/service";
import { startWorkerHeartbeat } from "./heartbeat";
import { objectivesEnabled, tickObjectives } from "@/lib/objectives/engine";
import { proactiveEnabled, runProactiveCycle } from "@/lib/autonomy/proactive-scan";
import { resumeRoomProactively } from "@/lib/orchestration/orchestrator";
import { defaultToolDeps } from "@/lib/objectives/service";

// This process executes the CLI runtimes, for orchestration runs and for the app's runtime calls
// alike. Read at call time (remote-execution.ts), so setting it here precedes every use.
process.env.SENTINEL_CLI_RUNTIME_HOST ??= "true";

const redisUrl = process.env.REDIS_URL;
if (!redisUrl) throw new Error("REDIS_URL is required for the orchestration worker.");

const workerId = orchestrationWorkerId();
const stopHeartbeat = startWorkerHeartbeat("orchestration-worker");
const worker = new Worker<OrchestrationJobPayload>(ORCHESTRATION_QUEUE_NAME, async (job) => executeOrchestrationRun(job.data.runId, workerId), {
  connection: { url: redisUrl, maxRetriesPerRequest: null },
  // Must match the queue side, or this worker silently consumes nothing.
  prefix: QUEUE_PREFIX,
  concurrency: Number(process.env.ORCHESTRATION_WORKER_CONCURRENCY ?? "1"),
});

// CLI runtime calls from the app (src/lib/agents/runtime/remote-execution.ts): this is the only
// Sentinel process with the claude/codex/gemini binaries and their credentials. A separate queue
// from "orchestration" so a chat turn never waits behind a long orchestration run, with its own
// concurrency because most calls are short health checks. One attempt, no retries.
const replies = new Redis(redisUrl, { maxRetriesPerRequest: 3 });
const runtimeCalls = new Worker<RuntimeCallPayload>(RUNTIME_CALL_QUEUE_NAME, async (job) => {
  const key = replyStreamKey(job.data.callId);
  await executeRuntimeCall(job.data, async (reply) => {
    await replies.multi().xadd(key, "*", "m", JSON.stringify(reply)).expire(key, REPLY_TTL_SECONDS).exec();
  }, { adapterFor: getLocalRuntimeAdapter, resolveRuntime: resolveRuntimeInstance });
}, {
  connection: { url: redisUrl, maxRetriesPerRequest: null },
  prefix: QUEUE_PREFIX,
  concurrency: Number(process.env.RUNTIME_CALL_CONCURRENCY ?? "16"),
  // A CLI task runs up to ten minutes; the lock must not expire under it.
  lockDuration: 60_000,
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
// Approved bot continuations whose enqueue failed (queue outage) are durable `queued` rows with a pending marker; this puts them on the queue.
const continuationRetry = setInterval(() => { void retryBotContinuations().catch((error) => console.error("[orchestration-worker] continuation retry failed", error instanceof Error ? error.message : error)); }, 30_000);
continuationRetry.unref();

// Autonomous objectives (docs/OBJECTIVES.md): state is in Postgres and each objective is leased while advanced,
// so a restart resumes from the last persisted step. Off unless SENTINEL_OBJECTIVES=on (the global kill switch).
let objectiveTickRunning = false;
const objectiveDeps = defaultToolDeps();
const objectiveTicker = setInterval(() => {
  if (objectiveTickRunning || !objectivesEnabled()) return;
  objectiveTickRunning = true;
  void tickObjectives(workerId, objectiveDeps)
    .catch((error) => console.error("[orchestration-worker] objective tick failed", error instanceof Error ? error.message : error))
    .finally(() => { objectiveTickRunning = false; });
}, Number(process.env.SENTINEL_OBJECTIVES_TICK_MS ?? "10000"));
objectiveTicker.unref();

// Proactive intelligence (src/lib/autonomy/proactive-scan.ts): detects unfinished/stalled work tied to existing
// objectives and resumes it within delegated authority. Off unless SENTINEL_PROACTIVE=on; per-workspace/agent
// throttles (interval, daily limit, min score) come from AutonomySettings.
let proactiveRunning = false;
const proactiveTicker = setInterval(() => {
  if (proactiveRunning || !proactiveEnabled()) return;
  proactiveRunning = true;
  void (async () => {
    const workspaces = await db.workspace.findMany({ where: { enabled: true }, select: { id: true }, take: 200 });
    for (const workspace of workspaces) {
      const result = await runProactiveCycle(workspace.id, { resumeRoom: resumeRoomProactively }).catch((error) => {
        console.error("[orchestration-worker] proactive cycle failed", workspace.id, error instanceof Error ? error.message : error);
        return null;
      });
      if (result?.started.length) console.log("[orchestration-worker] proactive work started", workspace.id, result.started);
    }
  })().finally(() => { proactiveRunning = false; });
}, Number(process.env.SENTINEL_PROACTIVE_TICK_MS ?? "300000"));
proactiveTicker.unref();

async function shutdown() {
  clearInterval(objectiveTicker);
  clearInterval(proactiveTicker);
  clearInterval(reconciler);
  clearInterval(continuationRetry);
  stopHeartbeat();
  await Promise.all([worker.close(), runtimeCalls.close()]);
  replies.disconnect();
  await db.$disconnect();
}
process.once("SIGTERM", () => void shutdown());
process.once("SIGINT", () => void shutdown());
