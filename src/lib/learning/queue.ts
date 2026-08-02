// Learning Core — real Redis-backed queue via BullMQ.
//
// This is genuinely new infrastructure for this repo (confirmed absent
// before writing this — no cron/BullMQ/node-cron/queue library existed
// anywhere; see docs/LEARNING_CORE_ON_NEURAL_ENGINE.md). Verified live
// against a running Redis instance and a real learning-worker process:
// connection succeeds, jobs register once across repeated startups
// (upsertJobScheduler dedup), a job executes successfully, a failing job
// retries then lands on the dead-letter queue, and the worker shuts down
// gracefully on SIGTERM. See docs/LEARNING_CORE_ON_NEURAL_ENGINE.md.
// Producers persist bounded retry/backoff settings with each job, and
// callers can close both singleton connections during worker shutdown or
// test teardown.
//
// BullMQ requires its own ioredis connection with maxRetriesPerRequest:
// null (blocking BRPOPLPUSH-style calls need unlimited retries) — this is
// deliberately a separate connection from src/lib/redis.ts's general-
// purpose client, which is intentionally lenient (maxRetriesPerRequest: 1,
// "Redis is optional") in the opposite direction.

import { Queue, type ConnectionOptions, type JobsOptions } from "bullmq";

export const LEARNING_QUEUE_NAME = "learning-core";
export const LEARNING_DEAD_LETTER_QUEUE_NAME = "learning-core-dead-letter";
export const LEARNING_JOB_ATTEMPTS = 3;
export const LEARNING_JOB_BACKOFF_MS = 1_000;

export const LEARNING_JOB_OPTIONS = {
  attempts: LEARNING_JOB_ATTEMPTS,
  backoff: { type: "exponential", delay: LEARNING_JOB_BACKOFF_MS },
  removeOnComplete: 100,
  removeOnFail: 500,
} satisfies JobsOptions;

export const JOB_NAMES = {
  degradationSweep: "degradation-sweep",
  knowledgeGapAnalysis: "knowledge-gap-analysis",
  experienceReplay: "experience-replay",
  coOccurrenceDiscovery: "co-occurrence-discovery",
} as const;

export type LearningJobName = (typeof JOB_NAMES)[keyof typeof JOB_NAMES];

// Cadence buckets from the spec's schedule table. Only the cadences with
// real backing logic are actually registered by scheduleRecurringJobs() —
// see that function's comment for exactly which named jobs from the spec
// are and are not implemented.
export const CRON = {
  hourly: "0 * * * *",
  nightly: "0 2 * * *", // 2am — after most traffic, before the next business day
  weekly: "0 3 * * 1", // Monday 3am
} as const;

function getConnectionOptions(): ConnectionOptions | null {
  const url = process.env.REDIS_URL;
  if (!url) return null;
  return { url, maxRetriesPerRequest: null };
}

let queue: Queue | null = null;
let deadLetterQueue: Queue | null = null;

/** Returns null when REDIS_URL isn't configured — callers must handle that, never assume a queue exists. */
export function getLearningQueue(): Queue | null {
  const connection = getConnectionOptions();
  if (!connection) return null;
  if (!queue) queue = new Queue(LEARNING_QUEUE_NAME, { connection });
  return queue;
}

export function getDeadLetterQueue(): Queue | null {
  const connection = getConnectionOptions();
  if (!connection) return null;
  if (!deadLetterQueue) deadLetterQueue = new Queue(LEARNING_DEAD_LETTER_QUEUE_NAME, { connection });
  return deadLetterQueue;
}

/** Close and clear singleton connections so a later call can reconnect cleanly. */
export async function closeLearningQueues(): Promise<void> {
  const openQueue = queue;
  const openDeadLetterQueue = deadLetterQueue;
  queue = null;
  deadLetterQueue = null;
  await Promise.all([
    openQueue?.close(),
    openDeadLetterQueue?.close(),
  ]);
}

export interface JobPayload {
  category?: string;
  triggeredBy: "schedule" | "manual";
}

/**
 * Registers the recurring jobs this repo actually has real handlers for.
 * Deduplication is automatic: BullMQ's repeat scheduler keys a repeatable
 * job by its (queue, jobName, repeat options) tuple — calling this again
 * with identical options is a no-op, not a duplicate schedule, which is
 * what makes this idempotent to call on every worker boot.
 *
 * NOT registered here — explicitly, not silently — because nothing in this
 * codebase implements them yet: 5-minute trace aggregation, hourly
 * preference-confidence recalculation / correction-pattern clustering
 * (evidence-weighted recalculation happens per-write today, not as a
 * periodic sweep), and monthly benchmark-refresh / artifact-cleanup /
 * graph-maintenance. Adding a job here without a real handler in
 * learning-worker.ts would be exactly the "UI-only functionality presented
 * as functional" this whole effort is trying not to do.
 */
export async function scheduleRecurringJobs(): Promise<{ scheduled: string[]; skipped: string } | null> {
  const q = getLearningQueue();
  if (!q) return null;

  // BullMQ v6: repeatable jobs go through upsertJobScheduler (add()'s
  // `repeat` option was removed in this major version) — upserting with the
  // same schedulerId + repeat options is itself the idempotency guarantee,
  // safe to call on every worker boot.
  await q.upsertJobScheduler(
    JOB_NAMES.degradationSweep,
    { pattern: CRON.nightly },
    { data: { triggeredBy: "schedule" } satisfies JobPayload, opts: LEARNING_JOB_OPTIONS }
  );
  await q.upsertJobScheduler(
    JOB_NAMES.knowledgeGapAnalysis,
    { pattern: CRON.weekly },
    { data: { triggeredBy: "schedule" } satisfies JobPayload, opts: LEARNING_JOB_OPTIONS }
  );
  await q.upsertJobScheduler(
    JOB_NAMES.coOccurrenceDiscovery,
    { pattern: CRON.weekly },
    { data: { triggeredBy: "schedule" } satisfies JobPayload, opts: LEARNING_JOB_OPTIONS }
  );
  for (const category of ["failure", "partial_outcome", "high_cost", "strongest_success", "rejected_answer", "rolled_back"]) {
    await q.upsertJobScheduler(
      `${JOB_NAMES.experienceReplay}:${category}`,
      { pattern: CRON.nightly },
      {
        name: JOB_NAMES.experienceReplay,
        data: { category, triggeredBy: "schedule" } satisfies JobPayload,
        opts: LEARNING_JOB_OPTIONS,
      }
    );
  }

  return {
    scheduled: [
      JOB_NAMES.degradationSweep,
      JOB_NAMES.knowledgeGapAnalysis,
      JOB_NAMES.coOccurrenceDiscovery,
      `${JOB_NAMES.experienceReplay} (x6 categories)`,
    ],
    skipped: "trace-aggregation, preference-confidence-recalc, monthly-maintenance — no real handler exists yet",
  };
}

export async function getQueueStatus() {
  const q = getLearningQueue();
  const dlq = getDeadLetterQueue();
  if (!q) return { configured: false as const };

  const [waiting, active, completed, failed, delayed] = await Promise.all([
    q.getWaitingCount(),
    q.getActiveCount(),
    q.getCompletedCount(),
    q.getFailedCount(),
    q.getDelayedCount(),
  ]);
  const deadLettered = dlq ? await dlq.getWaitingCount() : 0;

  return { configured: true as const, waiting, active, completed, failed, delayed, deadLettered };
}
