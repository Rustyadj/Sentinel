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
