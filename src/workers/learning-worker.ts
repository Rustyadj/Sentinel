#!/usr/bin/env node
// Learning Core worker process — the actual consumer for the BullMQ queue
// defined in src/lib/learning/queue.ts. Run via `npx tsx
// src/workers/learning-worker.ts` (see docker-compose.yml's learning-worker
// service, and package.json's "worker:learning" script).
//
// Verified live against a running Redis instance: connection succeeds, the
// worker starts and processes a real job to completion, a failing job
// retries and lands on the dead-letter queue after MAX_ATTEMPTS, repeated
// scheduleRecurringJobs() calls do not duplicate schedules, and SIGTERM
// closes the worker gracefully.

import { Worker, type Job } from "bullmq";
import {
  LEARNING_QUEUE_NAME,
  LEARNING_JOB_ATTEMPTS,
  JOB_NAMES,
  closeLearningQueues,
  getDeadLetterQueue,
  scheduleRecurringJobs,
  type JobPayload,
} from "@/lib/learning/queue";
import { runRecordedDegradationSweep } from "@/lib/neural-engine/scheduler-service";
import { detectKnowledgeGaps } from "@/lib/learning/knowledge-gaps";
import { generateLearningGoalsFromGaps } from "@/lib/learning/learning-goals";
import { runExperienceReplay, type ReplayCategory } from "@/lib/learning/replay";
import { runCoOccurrenceSelfImprovement } from "@/lib/learning/self-improvement";

const requestedConcurrency = Number(process.env.LEARNING_WORKER_CONCURRENCY ?? 2);
const CONCURRENCY = Number.isFinite(requestedConcurrency)
  ? Math.max(1, Math.min(16, Math.floor(requestedConcurrency)))
  : 2;
const requestedTimeout = Number(process.env.LEARNING_JOB_TIMEOUT_MS ?? 15 * 60 * 1_000);
const JOB_TIMEOUT_MS = Number.isFinite(requestedTimeout) && requestedTimeout > 0
  ? Math.floor(requestedTimeout)
  : 15 * 60 * 1_000;

async function processJob(job: Job<JobPayload>) {
  switch (job.name) {
    case JOB_NAMES.degradationSweep:
      return runRecordedDegradationSweep();
    case JOB_NAMES.knowledgeGapAnalysis: {
      const gaps = await detectKnowledgeGaps();
      const goals = await generateLearningGoalsFromGaps();
      return { gapsProcessed: gaps.length, goalsCreated: goals.length };
    }
    case JOB_NAMES.experienceReplay: {
      const category = job.data.category as ReplayCategory | undefined;
      if (!category) throw new Error("experience-replay job missing required 'category' field");
      return runExperienceReplay(category);
    }
    case JOB_NAMES.coOccurrenceDiscovery:
      return runCoOccurrenceSelfImprovement();
    default:
      throw new Error(`No handler registered for job "${job.name}" — refusing to silently no-op it.`);
  }
}

async function processJobWithDeadline(job: Job<JobPayload>) {
  let timeout: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      processJob(job),
      new Promise<never>((_, reject) => {
        timeout = setTimeout(
          () => reject(new Error(`Job ${job.id ?? job.name} exceeded ${JOB_TIMEOUT_MS}ms deadline`)),
          JOB_TIMEOUT_MS,
        );
      }),
    ]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

function startWorker() {
  const redisUrl = process.env.REDIS_URL;
  if (!redisUrl) {
    console.error("[learning-worker] REDIS_URL is not configured — worker cannot start. Exiting.");
    process.exit(1);
  }

  const worker = new Worker<JobPayload>(LEARNING_QUEUE_NAME, processJobWithDeadline, {
    connection: { url: redisUrl, maxRetriesPerRequest: null },
    concurrency: CONCURRENCY,
    autorun: true,
  });

  worker.on("completed", (job) => {
    console.log(`[learning-worker] completed ${job.name} (${job.id})`);
  });

  worker.on("failed", async (job, err) => {
    if (!job) return;
    console.error(`[learning-worker] failed ${job.name} (${job.id}), attempt ${job.attemptsMade}/${LEARNING_JOB_ATTEMPTS}:`, err.message);
    // Dead-letter: once retries are exhausted, BullMQ's own "failed" set
    // already holds the job (that's the built-in dead-letter list — no
    // separate DLQ construct is needed for inspection), but this also
    // copies it into a dedicated queue so an operator can requeue/inspect
    // without reaching into the main queue's internal failed-job set.
    if (job.attemptsMade >= LEARNING_JOB_ATTEMPTS) {
      const dlq = getDeadLetterQueue();
      if (dlq) {
        await dlq
          .add(job.name, { ...job.data, originalJobId: job.id, failureReason: err.message }, { removeOnComplete: 1000 })
          .catch((dlqErr) => console.error("[learning-worker] failed to write to dead-letter queue:", dlqErr));
      }
    }
  });

  worker.on("error", (err) => {
    console.error("[learning-worker] worker-level error (non-fatal):", err);
  });

  return worker;
}

async function main() {
  const worker = startWorker();

  const scheduled = await scheduleRecurringJobs();
  if (scheduled) {
    console.log("[learning-worker] scheduled recurring jobs:", scheduled.scheduled);
    console.log("[learning-worker] NOT scheduled (no handler exists yet):", scheduled.skipped);
  }

  let shuttingDown = false;
  async function shutdown(signal: string) {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log(`[learning-worker] received ${signal}, closing gracefully…`);
    await worker.close();
    await closeLearningQueues();
    process.exit(0);
  }
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
  process.on("SIGINT", () => void shutdown("SIGINT"));

  console.log(`[learning-worker] started — concurrency=${CONCURRENCY}, queue="${LEARNING_QUEUE_NAME}"`);
}

main().catch((err) => {
  console.error("[learning-worker] fatal startup error:", err);
  process.exit(1);
});
