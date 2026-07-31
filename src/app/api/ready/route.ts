import { db } from "@/lib/db";
import { getAllVpsAgents } from "@/lib/agents/registry";

export const dynamic = "force-dynamic";

async function checkDb(): Promise<{ ok: boolean; latencyMs?: number; error?: string }> {
  const start = Date.now();
  try {
    await db.$queryRaw`SELECT 1`;
    return { ok: true, latencyMs: Date.now() - start };
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }
}

async function checkRedis(): Promise<{ ok: boolean; latencyMs?: number; error?: string }> {
  if (!process.env.REDIS_URL) return { ok: true, latencyMs: 0 };
  const start = Date.now();
  try {
    const { redisGet } = await import("@/lib/redis");
    await redisGet("__ready_check__");
    return { ok: true, latencyMs: Date.now() - start };
  } catch (err) {
    return { ok: false, error: (err as Error).message };
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

  const agents = await getAllVpsAgents();
  const agentChecks = await Promise.all(
    agents.map(async (a) => ({ id: a.id, ...(await checkAgent(a.endpoint)) }))
  );

  const allReady = db_check.ok && redis_check.ok;
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
