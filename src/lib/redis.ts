import Redis from "ioredis";

let redis: Redis | null = null;

export function getRedis(): Redis | null {
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

export async function requireRedis(): Promise<Redis> {
  const client = getRedis();
  if (!client) throw new Error("Working memory unavailable: REDIS_URL is not configured.");
  if (client.status === "wait") await client.connect();
  return client;
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
