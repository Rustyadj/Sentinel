/**
 * BullMQ key prefix.
 *
 * Every BullMQ key is namespaced by this. It exists because one Redis instance
 * can host more than one consumer of the same queue name: a leftover
 * `worker:orchestration` process from a *different checkout* was found
 * attached to the vitest Redis, where it picked up the queue test's job,
 * failed it three times against its own database, and held the job lock — so
 * `job.remove()` raised "could not be removed because it is locked by another
 * worker". That was read as a test isolation flake for weeks. It was a foreign
 * consumer.
 *
 * Pointing the suite at a throwaway Redis is not enough on its own, because
 * anything else may be pointed there too. A distinct prefix makes the test
 * queues unreachable to any worker that does not share it.
 *
 * Production leaves BULLMQ_PREFIX unset and keeps BullMQ's default, so
 * existing queues and in-flight jobs are untouched.
 */
export const QUEUE_PREFIX = process.env.BULLMQ_PREFIX?.trim() || "bull";
