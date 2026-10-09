import { redisAcquireLease, redisReleaseLease, redisRenewLease } from "@/lib/redis";

const TTL_SECONDS = 90;
const keyFor = (runId: string) => `sentinel:orchestration:owner:${runId}`;

export function orchestrationWorkerId() {
  return process.env.ORCHESTRATION_WORKER_ID ?? `${process.env.HOSTNAME ?? "worker"}:${process.pid}`;
}

export async function acquireExecutionOwnership(runId: string, workerId: string) {
  return redisAcquireLease(keyFor(runId), workerId, TTL_SECONDS);
}
export async function renewExecutionOwnership(runId: string, workerId: string) {
  return redisRenewLease(keyFor(runId), workerId, TTL_SECONDS);
}
export async function releaseExecutionOwnership(runId: string, workerId: string) {
  return redisReleaseLease(keyFor(runId), workerId);
}

/** How long a worker keeps a run's lease after it could not confirm that the runtime session stopped. */
const UNCONFIRMED_HOLD_SECONDS = 6 * 60 * 60;

/**
 * Keep ownership of a run whose runtime session may still be executing. The
 * normal lease is released when the worker is done with a run; for a session
 * that could not be confirmed stopped, "done" is not true, so the lease is
 * stretched instead of dropped. Only a confirmed stop releases it.
 */
export async function holdExecutionOwnership(runId: string, workerId: string) {
  return redisRenewLease(keyFor(runId), workerId, UNCONFIRMED_HOLD_SECONDS);
}
