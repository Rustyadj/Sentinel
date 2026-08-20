// The mobile app authenticates with a bearer token instead of a session
// cookie (see src/lib/mobile-auth.ts and requireApiUser in current-user.ts).
// This is a security boundary — a forged or expired token has to be
// rejected exactly as reliably as an absent one — so it's covered on its
// own, independent of any route that happens to consume it.
import { createHmac } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { signMobileToken, verifyMobileToken } from "@/lib/mobile-auth";

describe("mobile-auth — bearer token sign/verify", () => {
  const originalSecret = process.env.AUTH_SECRET;

  beforeEach(() => {
    process.env.AUTH_SECRET = "test-only-secret-do-not-use-in-prod";
  });

  afterEach(() => {
    process.env.AUTH_SECRET = originalSecret;
  });

  it("round-trips a valid token", () => {
    const token = signMobileToken({ sub: "user-1", email: "a@example.com" });
    expect(verifyMobileToken(token)).toEqual({ sub: "user-1", email: "a@example.com" });
  });

  it("rejects a token signed under a different secret", () => {
    const token = signMobileToken({ sub: "user-1", email: "a@example.com" });
    process.env.AUTH_SECRET = "a-completely-different-secret";
    expect(verifyMobileToken(token)).toBeNull();
  });

  it("rejects a tampered payload even though the signature segment is untouched", () => {
    const token = signMobileToken({ sub: "user-1", email: "a@example.com" });
    const [header, , signature] = token.split(".");
    const forgedBody = Buffer.from(JSON.stringify({ sub: "someone-else", email: "a@example.com", exp: 9999999999 })).toString(
      "base64url",
    );
    expect(verifyMobileToken(`${header}.${forgedBody}.${signature}`)).toBeNull();
  });

  it("rejects malformed tokens (wrong segment count, garbage, empty string)", () => {
    expect(verifyMobileToken("not-a-token")).toBeNull();
    expect(verifyMobileToken("a.b.c.d")).toBeNull();
    expect(verifyMobileToken("")).toBeNull();
  });

  it("rejects an expired token", () => {
    const header = Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString("base64url");
    const expiredBody = Buffer.from(
      JSON.stringify({ sub: "user-1", email: "a@example.com", iat: 0, exp: 1 }),
    ).toString("base64url");
    // Re-derive the signature the same way signMobileToken does, so this
    // exercises expiry checking specifically rather than signature failure.
    const signature = createHmac("sha256", process.env.AUTH_SECRET!)
      .update(`${header}.${expiredBody}`)
      .digest("base64url");
    expect(verifyMobileToken(`${header}.${expiredBody}.${signature}`)).toBeNull();
  });

  it("rejects a token missing sub/email even with a valid signature", () => {
    const header = Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString("base64url");
    const incompleteBody = Buffer.from(JSON.stringify({ email: "a@example.com", exp: 9999999999 })).toString(
      "base64url",
    );
    const signature = createHmac("sha256", process.env.AUTH_SECRET!)
      .update(`${header}.${incompleteBody}`)
      .digest("base64url");
    expect(verifyMobileToken(`${header}.${incompleteBody}.${signature}`)).toBeNull();
  });
});
