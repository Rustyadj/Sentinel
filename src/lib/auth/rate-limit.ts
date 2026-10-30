import { redisGet, redisIncrementWithExpiry } from "@/lib/redis";

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
  /** Failed sign-ins against one account, from anywhere (password guessing). */
  loginPerAccount: { bucket: "login:account", max: 10, windowSeconds: 15 * 60 },
  /** Failed sign-ins from one address, across accounts (password spraying). */
  loginPerAddress: { bucket: "login:address", max: 30, windowSeconds: 15 * 60 },
  /** Every registration attempt from one address. */
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

function windowKey(limit: AuthRateLimit, subject: string): string {
  const window = Math.floor(Date.now() / (limit.windowSeconds * 1_000));
  return `auth:rate:${limit.bucket}:${subject.toLowerCase()}:${window}`;
}

async function increment(limit: AuthRateLimit, subject: string): Promise<number> {
  const key = windowKey(limit, subject);
  return (await redisIncrementWithExpiry(key, limit.windowSeconds + 1)) ?? memoryIncrement(key, limit.windowSeconds);
}

/** Counts one attempt and reports whether it is still within the limit. */
export async function consumeAuthAttempt(limit: AuthRateLimit, subject: string): Promise<boolean> {
  return (await increment(limit, subject)) <= limit.max;
}

/**
 * Sign-in throttling counts failures only, so a legitimate user signing in
 * repeatedly never locks themselves out. Checked before the password is
 * verified, so a throttled subject costs no bcrypt work and learns nothing.
 * Reads both stores because failures are recorded in memory while Redis is down.
 */
export async function isAuthThrottled(limit: AuthRateLimit, subject: string): Promise<boolean> {
  const key = windowKey(limit, subject);
  const memory = memoryWindows.get(key);
  const memoryCount = memory && memory.expiresAt > Date.now() ? memory.count : 0;
  const redisCount = Number(await redisGet(key)) || 0;
  return Math.max(memoryCount, redisCount) >= limit.max;
}

export async function recordAuthFailure(limit: AuthRateLimit, subject: string): Promise<void> {
  await increment(limit, subject);
}

/** The two sign-in limits, applied identically by the web and mobile sign-in paths. */
export function signInSubjects(email: string, headers: Headers): Array<[AuthRateLimit, string]> {
  return [
    [AUTH_RATE_LIMITS.loginPerAccount, email.trim().toLowerCase()],
    [AUTH_RATE_LIMITS.loginPerAddress, clientAddress(headers)],
  ];
}

export async function isSignInThrottled(email: string, headers: Headers): Promise<boolean> {
  const checks = await Promise.all(signInSubjects(email, headers).map(([limit, subject]) => isAuthThrottled(limit, subject)));
  return checks.some(Boolean);
}

export async function recordSignInFailure(email: string, headers: Headers): Promise<void> {
  await Promise.all(signInSubjects(email, headers).map(([limit, subject]) => recordAuthFailure(limit, subject)));
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
