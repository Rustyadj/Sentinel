import Redis from "ioredis";

let redis: Redis | null = null;

function getRedis(): Redis | null {
  if (!process.env.REDIS_URL) return null;
  if (!redis) {
    redis = new Redis(process.env.REDIS_URL, {
      lazyConnect: true,
      maxRetriesPerRequest: 1,
      enableReadyCheck: false,
    });
    redis.on("error", () => { /* suppress — Redis is optional */ });
  }
  return redis;
}

export async function redisHealth(): Promise<{ configured: boolean; ok: boolean; latencyMs?: number; error?: string }> {
  const client = getRedis();
  if (!client) return { configured: false, ok: false, error: "REDIS_URL is not configured" };
  const startedAt = Date.now();
  try {
    if (client.status === "wait") await client.connect();
    await client.ping();
    return { configured: true, ok: true, latencyMs: Date.now() - startedAt };
  } catch {
    return { configured: true, ok: false, error: "Redis did not respond" };
  }
}

export async function redisGet(key: string): Promise<string | null> {
  try {
    const client = getRedis();
    if (!client) return null;
    return await client.get(key);
  } catch { return null; }
}

export async function redisSet(key: string, value: string, ttlSeconds?: number): Promise<void> {
  try {
    const client = getRedis();
    if (!client) return;
    if (ttlSeconds) {
      await client.setex(key, ttlSeconds, value);
    } else {
      await client.set(key, value);
    }
  } catch { /* ignore */ }
}

export async function redisDel(key: string): Promise<void> {
  try {
    const client = getRedis();
    if (!client) return;
    await client.del(key);
  } catch { /* ignore */ }
}

export async function redisKeys(pattern: string): Promise<string[]> {
  try {
    const client = getRedis();
    if (!client) return [];
    return await client.keys(pattern);
  } catch { return []; }
}

/** Atomic fixed-window counter for externally exposed interfaces. Unlike the
 * optional cache helpers above, callers must fail closed when this returns
 * null because a missing rate limiter is not a safe external posture. */
export async function redisIncrementWithExpiry(key: string, ttlSeconds: number): Promise<number | null> {
  try {
    const client = getRedis();
    if (!client) return null;
    if (client.status === "wait") await client.connect();
    const count = await client.incr(key);
    if (count === 1) await client.expire(key, ttlSeconds);
    return count;
  } catch { return null; }
}
