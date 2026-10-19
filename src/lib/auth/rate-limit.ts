import { redisIncrementWithExpiry } from "@/lib/redis";

/**
 * Throttling for the unauthenticated credential endpoints (web sign-in, mobile
 * sign-in, registration). Same fixed-window Redis counter as the MCP limiter
 * in src/lib/integrations/rate-limit.ts.
 *
 * When Redis is unreachable the counter falls back to this process's memory
 * rather than failing open (unthrottled password guessing) or closed (the
 * operator locked out of their own instance during a Redis outage). The app
 * runs as a single container, so the in-memory window is still meaningful.
 */
export interface AuthRateLimit {
  bucket: string;
  max: number;
  windowSeconds: number;
}

export const AUTH_RATE_LIMITS = {
  /** Guessing one account's password, from anywhere. */
  loginPerAccount: { bucket: "login:account", max: 10, windowSeconds: 15 * 60 },
  /** Spraying many accounts from one address. */
  loginPerAddress: { bucket: "login:address", max: 30, windowSeconds: 15 * 60 },
  registerPerAddress: { bucket: "register:address", max: 5, windowSeconds: 60 * 60 },
} satisfies Record<string, AuthRateLimit>;

const memoryWindows = new Map<string, { count: number; expiresAt: number }>();
const MAX_MEMORY_KEYS = 10_000;

function memoryIncrement(key: string, windowSeconds: number): number {
  const now = Date.now();
  const entry = memoryWindows.get(key);
  if (entry && entry.expiresAt > now) {
    entry.count += 1;
    return entry.count;
  }
  if (memoryWindows.size >= MAX_MEMORY_KEYS) {
    for (const [stale, value] of memoryWindows) if (value.expiresAt <= now) memoryWindows.delete(stale);
    // Still full of live windows: drop the oldest rather than grow unbounded.
    if (memoryWindows.size >= MAX_MEMORY_KEYS) memoryWindows.delete(memoryWindows.keys().next().value!);
  }
  memoryWindows.set(key, { count: 1, expiresAt: now + windowSeconds * 1_000 });
  return 1;
}

/** Counts one attempt and reports whether it is still within the limit. */
export async function consumeAuthAttempt(limit: AuthRateLimit, subject: string): Promise<boolean> {
  const window = Math.floor(Date.now() / (limit.windowSeconds * 1_000));
  const key = `auth:rate:${limit.bucket}:${subject.toLowerCase()}:${window}`;
  const count = (await redisIncrementWithExpiry(key, limit.windowSeconds + 1)) ?? memoryIncrement(key, limit.windowSeconds);
  return count <= limit.max;
}

/**
 * Client address for rate-limit keys. Behind Traefik the socket address is the
 * proxy; Traefik replaces untrusted X-Forwarded-For, so its first hop is the
 * client (same convention as the MCP registration limiter).
 */
export function clientAddress(headers: Headers): string {
  return (
    headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    headers.get("x-real-ip")?.trim() ||
    "unknown"
  );
}

export function tooManyAttempts(): Response {
  return Response.json(
    { error: "Too many attempts. Try again later." },
    { status: 429, headers: { "Retry-After": "900" } },
  );
}

/** Test hook: the in-memory fallback is process-global. */
export function resetMemoryRateLimits() {
  memoryWindows.clear();
}
