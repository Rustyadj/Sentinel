import { db } from "@/lib/db";
import { listRuntimeViews, getRuntimeAdapter } from "@/lib/agents/runtime/service";
import { asRuntimeInstance } from "@/lib/agents/runtime/config";
import { getOrchestrationQueue } from "@/lib/orchestration/queue";
import { redisGet, redisSet } from "@/lib/redis";
import { logger } from "@/lib/logger";
import type { RuntimeView } from "@/lib/agents/runtime/types";

export const dynamic = "force-dynamic";

/**
 * Readiness reports architectural truth, not optimism.
 *
 * REQUIRED — Sentinel genuinely cannot serve its purpose without these, so a
 * failure here is a real 503:
 *   * postgres            — every route reads or writes it
 *   * redis               — durable orchestration, execution ownership leases
 *                           and external-interface rate limiting all fail
 *                           *open or unsafe* without it
 *   * orchestration queue — a run that is accepted but never executed is worse
 *                           than a refused one, so an attached worker is part
 *                           of being ready
 *   * runtime registry    — Sentinel must be able to resolve at least one
 *                           enabled, execution-verified runtime, or it can
 *                           accept work it can never dispatch
 *
 * OPTIONAL — individual agent runtimes. A runtime being unreachable or
 * unauthenticated is a fact Sentinel *reports accurately*; it is not Sentinel
 * being dead. Sentinel is still correctly serving requests, still telling the
 * truth about that runtime, and still able to dispatch to the others. Gating
 * readiness on them is what made production return 503 for an absent runtime.
 *
 * Runtime probes are cached briefly: a readiness probe runs every few seconds,
 * and health() for a CLI runtime spawns real processes.
 */

const RUNTIME_PROBE_CACHE_KEY = "sentinel:ready:runtimes";
const RUNTIME_PROBE_TTL_SECONDS = 30;
const RUNTIME_PROBE_BUDGET_MS = 4_000;

type Check = { ok: boolean; latencyMs?: number; error?: string };
type RuntimeState = "available" | "busy" | "auth_required" | "unavailable" | "unknown";
type RuntimeReport = { id: string; agentId: string; kind: string; required: false; state: RuntimeState; detail?: string };

async function checkDatabase(): Promise<Check> {
  const start = Date.now();
  try {
    await db.$queryRaw`SELECT 1`;
    return { ok: true, latencyMs: Date.now() - start };
  } catch (err) {
    logger.error("readiness.database_failed", { error: err instanceof Error ? err.message : String(err) });
    return { ok: false, error: "Database unavailable" };
  }
}

async function checkRedis(): Promise<Check> {
  try {
    const { redisHealth } = await import("@/lib/redis");
    const result = await redisHealth();
    if (result.ok) return { ok: true, latencyMs: result.latencyMs };
    return { ok: false, error: result.configured ? "Redis did not respond" : "REDIS_URL is not configured" };
  } catch (err) {
    logger.error("readiness.redis_failed", { error: err instanceof Error ? err.message : String(err) });
    return { ok: false, error: "Redis unavailable" };
  }
}

/** An accepted run must have something that will execute it. */
async function checkOrchestrationWorker(): Promise<Check> {
  const start = Date.now();
  try {
    const queue = getOrchestrationQueue();
    if (!queue) return { ok: false, error: "Orchestration queue is not configured (REDIS_URL missing)" };
    const workers = await queue.getWorkers();
    return workers.length > 0
      ? { ok: true, latencyMs: Date.now() - start }
      : { ok: false, error: "No orchestration worker is attached to the queue" };
  } catch (err) {
    logger.error("readiness.orchestration_failed", { error: err instanceof Error ? err.message : String(err) });
    return { ok: false, error: "Orchestration queue unreachable" };
  }
}

function classify(health: {
  ready: boolean; busy: boolean; reachable: boolean; authenticated: boolean | null; failureCode?: string;
}): { state: RuntimeState; detail?: string } {
  if (health.authenticated === false || health.failureCode === "not_authenticated") {
    return { state: "auth_required", detail: "Runtime requires provider authentication" };
  }
  if (health.ready) return { state: health.busy ? "busy" : "available" };
  if (!health.reachable) return { state: "unavailable", detail: health.failureCode ?? "unreachable" };
  return { state: "unknown", detail: health.failureCode ?? "not_ready" };
}

async function probeRuntimes(runtimes: RuntimeView[]): Promise<RuntimeReport[]> {
  const deadline = new Promise<null>((resolve) => setTimeout(() => resolve(null), RUNTIME_PROBE_BUDGET_MS).unref?.());
  return Promise.all(
    runtimes.map(async (runtime): Promise<RuntimeReport> => {
      const base = { id: runtime.id, agentId: runtime.agentId, kind: runtime.kind, required: false as const };
      try {
        const health = await Promise.race([
          getRuntimeAdapter(runtime.kind).health(asRuntimeInstance(runtime)),
          deadline,
        ]);
        if (!health) return { ...base, state: "unknown", detail: "probe_timeout" };
        return { ...base, ...classify(health) };
      } catch {
        return { ...base, state: "unavailable", detail: "probe_failed" };
      }
    })
  );
}

async function runtimeSection(): Promise<{ registry: Check; runtimes: RuntimeReport[] }> {
  let runtimes: RuntimeView[];
  try {
    runtimes = await listRuntimeViews();
  } catch (err) {
    logger.error("readiness.registry_failed", { error: err instanceof Error ? err.message : String(err) });
    return { registry: { ok: false, error: "Runtime registry could not be read" }, runtimes: [] };
  }

  const dispatchable = runtimes.filter((runtime) => runtime.enabled && runtime.executionVerified);
  const registry: Check = dispatchable.length > 0
    ? { ok: true }
    : { ok: false, error: "No enabled, execution-verified runtime is registered" };

  const cached = await redisGet(RUNTIME_PROBE_CACHE_KEY);
  if (cached) {
    try { return { registry, runtimes: JSON.parse(cached) as RuntimeReport[] }; } catch { /* re-probe */ }
  }
  const reports = await probeRuntimes(runtimes.filter((runtime) => runtime.enabled));
  await redisSet(RUNTIME_PROBE_CACHE_KEY, JSON.stringify(reports), RUNTIME_PROBE_TTL_SECONDS);
  return { registry, runtimes: reports };
}

export async function GET() {
  const [database, redis, orchestration, runtimeInfo] = await Promise.all([
    checkDatabase(),
    checkRedis(),
    checkOrchestrationWorker(),
    runtimeSection(),
  ]);

  const required = {
    database,
    redis,
    orchestrationWorker: orchestration,
    runtimeRegistry: runtimeInfo.registry,
  };
  const ready = Object.values(required).every((check) => check.ok);

  return Response.json(
    {
      ready,
      required,
      // Reported, never gating. `state` is the honest answer to "can Sentinel
      // use this runtime right now?" — including auth_required, which means the
      // runtime is installed and reachable but needs re-authentication.
      optional: { runtimes: runtimeInfo.runtimes },
      timestamp: new Date().toISOString(),
    },
    { status: ready ? 200 : 503 }
  );
}
