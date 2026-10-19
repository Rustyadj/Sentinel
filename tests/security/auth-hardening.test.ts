import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { AUTH_RATE_LIMITS, consumeAuthAttempt, resetMemoryRateLimits } from "@/lib/auth/rate-limit";
import { emailMatchesAllowlist, isSignupAllowed } from "@/lib/auth/signup-policy";
import { isMobileTokenRevoked, signMobileToken, verifyMobileToken } from "@/lib/mobile-auth";
import { requireApiUser } from "@/lib/current-user";
import * as registerRoute from "@/app/api/auth/register/route";
import * as mobileLoginRoute from "@/app/api/auth/mobile/login/route";
import * as revokeRoute from "@/app/api/auth/mobile/revoke/route";

const suffix = `${process.pid}-${Date.now().toString(36)}`;
const createdEmails: string[] = [];
let address = 0;
/** A fresh client address per test, so limits from one test never leak into another. */
const nextAddress = () => `10.9.${Math.floor(++address / 250)}.${address % 250}`;

function post(url: string, body: unknown, ip: string, headers: Record<string, string> = {}) {
  return new NextRequest(url, {
    method: "POST",
    headers: { "content-type": "application/json", "x-forwarded-for": ip, ...headers },
    body: JSON.stringify(body),
  });
}

const env = { ...process.env };
beforeEach(() => {
  process.env.AUTH_SECRET = "test-secret-for-auth-hardening";
  delete process.env.SENTINEL_OPEN_SIGNUP;
  delete process.env.SENTINEL_SIGNUP_ALLOWLIST;
  delete process.env.MOBILE_TOKEN_TTL_SECONDS;
  resetMemoryRateLimits();
});
afterEach(() => { process.env = { ...env }; });
afterAll(async () => { await db.user.deleteMany({ where: { email: { in: createdEmails } } }); });

describe("signup policy", () => {
  it("matches exact emails and @domain entries, case-insensitively", () => {
    expect(emailMatchesAllowlist("Alice@Example.com", ["alice@example.com"])).toBe(true);
    expect(emailMatchesAllowlist("bob@team.dev", ["@team.dev"])).toBe(true);
    expect(emailMatchesAllowlist("bob@evil-team.dev", ["@team.dev"])).toBe(false);
    expect(emailMatchesAllowlist("bob@team.dev.evil.com", ["@team.dev"])).toBe(false);
  });

  it("is closed by default once any account exists", async () => {
    expect(await db.user.count()).toBeGreaterThan(0); // the seeded owner
    expect(await isSignupAllowed(`stranger-${suffix}@example.com`)).toBe(false);
    process.env.SENTINEL_SIGNUP_ALLOWLIST = "@example.com";
    expect(await isSignupAllowed(`stranger-${suffix}@example.com`)).toBe(true);
    delete process.env.SENTINEL_SIGNUP_ALLOWLIST;
    process.env.SENTINEL_OPEN_SIGNUP = "true";
    expect(await isSignupAllowed(`stranger-${suffix}@example.com`)).toBe(true);
  });
});

describe("POST /api/auth/register", () => {
  it("refuses a non-allowlisted address without creating a row", async () => {
    const email = `blocked-${suffix}@example.com`;
    const res = await registerRoute.POST(post("http://x/api/auth/register", { email, password: "long-enough-pw" }, nextAddress()));
    expect(res.status).toBe(403);
    expect(await db.user.count({ where: { email } })).toBe(0);
  });

  it("creates an allowlisted account", async () => {
    const email = `invited-${suffix}@example.com`;
    createdEmails.push(email);
    process.env.SENTINEL_SIGNUP_ALLOWLIST = email;
    const res = await registerRoute.POST(post("http://x/api/auth/register", { email, password: "long-enough-pw" }, nextAddress()));
    expect(res.status).toBe(201);
  });

  it("rejects malformed bodies", async () => {
    const ip = nextAddress();
    expect((await registerRoute.POST(new NextRequest("http://x", { method: "POST", body: "{", headers: { "x-forwarded-for": ip } }))).status).toBe(400);
    expect((await registerRoute.POST(post("http://x", { email: ["a"], password: "x".repeat(10) }, ip))).status).toBe(400);
    expect((await registerRoute.POST(post("http://x", { email: "not-an-email", password: "x".repeat(10) }, ip))).status).toBe(400);
  });

  it("throttles repeated registration attempts from one address", async () => {
    const ip = nextAddress();
    const statuses: number[] = [];
    for (let i = 0; i <= AUTH_RATE_LIMITS.registerPerAddress.max; i += 1) {
      statuses.push((await registerRoute.POST(post("http://x", { email: `r${i}-${suffix}@example.com`, password: "long-enough-pw" }, ip))).status);
    }
    expect(statuses.slice(0, -1).every((status) => status === 403)).toBe(true);
    expect(statuses.at(-1)).toBe(429);
  });
});

describe("login rate limiting", () => {
  it("allows exactly `max` attempts per subject per window", async () => {
    const subject = `subject-${suffix}`;
    for (let i = 0; i < AUTH_RATE_LIMITS.loginPerAccount.max; i += 1) {
      expect(await consumeAuthAttempt(AUTH_RATE_LIMITS.loginPerAccount, subject)).toBe(true);
    }
    expect(await consumeAuthAttempt(AUTH_RATE_LIMITS.loginPerAccount, subject)).toBe(false);
  });

  it("locks out password guessing on the mobile endpoint even with the right password later", async () => {
    const email = `mobile-${suffix}@example.com`;
    createdEmails.push(email);
    const bcrypt = (await import("bcryptjs")).default;
    await db.user.create({ data: { email, passwordHash: await bcrypt.hash("correct-password", 4) } });

    for (let i = 0; i < AUTH_RATE_LIMITS.loginPerAccount.max; i += 1) {
      const res = await mobileLoginRoute.POST(post("http://x", { email, password: `wrong-${i}` }, nextAddress()));
      expect(res.status).toBe(401);
    }
    const res = await mobileLoginRoute.POST(post("http://x", { email, password: "correct-password" }, nextAddress()));
    expect(res.status).toBe(429);
  });
});

describe("mobile bearer tokens", () => {
  it("defaults to a 7-day lifetime and caps configured lifetimes at 30 days", () => {
    const lifetime = (token: string) => {
      const body = JSON.parse(Buffer.from(token.split(".")[1], "base64url").toString()) as { iat: number; exp: number };
      return body.exp - body.iat;
    };
    expect(lifetime(signMobileToken({ sub: "u", email: "e" }))).toBe(7 * 86_400);
    process.env.MOBILE_TOKEN_TTL_SECONDS = String(365 * 86_400);
    expect(lifetime(signMobileToken({ sub: "u", email: "e" }))).toBe(30 * 86_400);
  });

  it("rejects a correctly signed token that has no exp", async () => {
    const { createHmac } = await import("node:crypto");
    const header = Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString("base64url");
    const body = Buffer.from(JSON.stringify({ sub: "u", email: "e", iat: 1 })).toString("base64url");
    const sig = createHmac("sha256", process.env.AUTH_SECRET!).update(`${header}.${body}`).digest("base64url");
    expect(verifyMobileToken(`${header}.${body}.${sig}`)).toBeNull();
  });

  it("treats tokens issued at or before the revocation instant as revoked", () => {
    const token = { sub: "u", email: "e", iat: 1_000 };
    expect(isMobileTokenRevoked(token, null)).toBe(false);
    expect(isMobileTokenRevoked(token, new Date(1_000_500))).toBe(true);
    expect(isMobileTokenRevoked(token, new Date(999_000))).toBe(false);
  });

  it("revoke endpoint invalidates every outstanding token for that user only", async () => {
    const email = `revoke-${suffix}@example.com`;
    const otherEmail = `revoke-other-${suffix}@example.com`;
    createdEmails.push(email, otherEmail);
    const user = await db.user.create({ data: { email } });
    const other = await db.user.create({ data: { email: otherEmail } });
    // Issued strictly before the revocation second.
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(Date.now() - 5_000);
    const token = signMobileToken({ sub: user.id, email });
    const otherToken = signMobileToken({ sub: other.id, email: otherEmail });
    vi.useRealTimers();
    const bearer = (t: string) => new NextRequest("http://x", { headers: { authorization: `Bearer ${t}` } });

    expect((await requireApiUser(bearer(token))).id).toBe(user.id);
    const res = await revokeRoute.POST(new NextRequest("http://x", { method: "POST", headers: { authorization: `Bearer ${token}` } }));
    expect(res.status).toBe(200);
    await expect(requireApiUser(bearer(token))).rejects.toThrow("Unauthorized");
    expect((await requireApiUser(bearer(otherToken))).id).toBe(other.id);
  });
});
