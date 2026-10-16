// A worker has no HTTP port, so "the process is up" is all Docker can see by
// default: a worker that lost its database or Redis, or wedged on startup, reads as
// healthy. The heartbeat is written only after a real round trip to both, and the
// container healthcheck (docker-compose.yml) fails when it goes stale — so
// readiness means the worker can reach what it works against.
import { writeFile } from "node:fs/promises";
import { db } from "@/lib/db";
import { redisHealth } from "@/lib/redis";

export const HEARTBEAT_FILE = process.env.WORKER_HEARTBEAT_FILE ?? "/tmp/worker-heartbeat";
export const HEARTBEAT_INTERVAL_MS = 15_000;

/** One probe: the database answers and Redis answers. Throws, naming the dependency, otherwise. */
export async function probeWorkerDependencies(): Promise<void> {
  await db.$queryRaw`SELECT 1`.catch(() => { throw new Error("database unreachable"); });
  const redis = await redisHealth();
  if (!redis.ok) throw new Error(`redis unavailable: ${redis.error ?? "no response"}`);
}

export function startWorkerHeartbeat(name: string, probe: () => Promise<void> = probeWorkerDependencies): () => void {
  let healthy: boolean | null = null;
  const beat = async () => {
    try {
      await probe();
      await writeFile(HEARTBEAT_FILE, String(Date.now()));
      if (healthy === false) console.log(`[${name}] dependencies recovered`);
      healthy = true;
    } catch (error) {
      // No beat is the signal; log only on the transition so a long outage is one line, not thousands.
      if (healthy !== false) console.error(`[${name}] not ready: ${error instanceof Error ? error.message : String(error)}`);
      healthy = false;
    }
  };
  void beat();
  const timer = setInterval(() => void beat(), HEARTBEAT_INTERVAL_MS);
  timer.unref();
  console.log(`[${name}] release ${process.env.SENTINEL_COMMIT ?? "unknown"} starting`);
  return () => clearInterval(timer);
}
