import { Queue, type ConnectionOptions, type JobsOptions } from "bullmq";
import { QUEUE_PREFIX } from "@/lib/queue-prefix";

export const ORCHESTRATION_QUEUE_NAME = "orchestration";
export const ORCHESTRATION_JOB_OPTIONS = {
  attempts: 3,
  backoff: { type: "exponential", delay: 2_000 },
  removeOnComplete: 500,
  removeOnFail: 500,
} satisfies JobsOptions;

export interface OrchestrationJobPayload { runId: string }

function connection(): ConnectionOptions | null {
  return process.env.REDIS_URL ? { url: process.env.REDIS_URL, maxRetriesPerRequest: null } : null;
}

let queue: Queue<OrchestrationJobPayload> | null = null;

export function getOrchestrationQueue(): Queue<OrchestrationJobPayload> | null {
  const options = connection();
  if (!options) return null;
  if (!queue) queue = new Queue<OrchestrationJobPayload>(ORCHESTRATION_QUEUE_NAME, { connection: options, prefix: QUEUE_PREFIX });
  return queue;
}

export async function enqueueOrchestrationRun(runId: string): Promise<void> {
  const target = getOrchestrationQueue();
  if (!target) throw new Error("REDIS_URL is required for durable orchestration execution.");
  await target.add("execute-run", { runId }, { ...ORCHESTRATION_JOB_OPTIONS, jobId: runId });
}

export async function closeOrchestrationQueue(): Promise<void> {
  const current = queue;
  queue = null;
  await current?.close();
}
