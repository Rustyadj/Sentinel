import { db } from "@/lib/db";
import { getAllVpsAgents } from "@/lib/agents/registry";
import { logger } from "@/lib/logger";

export const dynamic = "force-dynamic";

async function checkDb(): Promise<{ ok: boolean; latencyMs?: number; error?: string }> {
  const start = Date.now();
  try {
    await db.$queryRaw`SELECT 1`;
    return { ok: true, latencyMs: Date.now() - start };
  } catch (err) {
    logger.error("readiness.database_failed", { error: err instanceof Error ? err.message : String(err) });
    return { ok: false, error: "Database unavailable" };
  }
}

async function checkRedis(): Promise<{ ok: boolean; latencyMs?: number; error?: string }> {
  if (!process.env.REDIS_URL) return { ok: false, error: "REDIS_URL is not configured" };
  const start = Date.now();
  try {
    const { redisGet } = await import("@/lib/redis");
    await redisGet("__ready_check__");
    return { ok: true, latencyMs: Date.now() - start };
  } catch (err) {
    logger.error("readiness.redis_failed", { error: err instanceof Error ? err.message : String(err) });
    return { ok: false, error: "Redis unavailable" };
  }
}

async function checkAgent(endpoint: string): Promise<{ ok: boolean; latencyMs?: number }> {
  const start = Date.now();
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 3000);
    const res = await fetch(endpoint, { signal: controller.signal });
    clearTimeout(timeout);
    return { ok: res.ok || res.status < 500, latencyMs: Date.now() - start };
  } catch {
    return { ok: false };
  }
}

export async function GET() {
  const [db_check, redis_check] = await Promise.all([checkDb(), checkRedis()]);

  const agents = getAllVpsAgents();
  const agentChecks = await Promise.all(
    agents.map(async (a) => ({ id: a.id, ...(await checkAgent(a.endpoint)) }))
  );

  const agentsReady = agentChecks.every((agent) => agent.ok);
  const allReady = db_check.ok && redis_check.ok && agentsReady;
  const status = allReady ? 200 : 503;

  return Response.json(
    {
      ready: allReady,
      checks: {
        database: db_check,
        redis: redis_check,
        agents: Object.fromEntries(agentChecks.map((a) => [a.id, { ok: a.ok, latencyMs: a.latencyMs }])),
      },
      timestamp: new Date().toISOString(),
    },
    { status }
  );
}
