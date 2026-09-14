import { describe, expect, it } from "vitest";
import {
  assertAllowedScopes,
  hashOpaqueSecret,
  normalizeScopes,
  OAuthProtocolError,
  verifyPkceS256,
} from "@/lib/integrations/oauth";
import { createHash } from "node:crypto";

describe("MCP OAuth protocol primitives", () => {
  it("requires only registered, explicit scopes", () => {
    const scopes = normalizeScopes("sentinel.read sentinel.memory.read");
    expect(scopes).toEqual(["sentinel.read", "sentinel.memory.read"]);
    expect(() => assertAllowedScopes(scopes, ["sentinel.read"])).toThrow(OAuthProtocolError);
  });

  it("rejects unknown scopes", () => {
    expect(() => normalizeScopes("sentinel.shell.execute")).toThrow(OAuthProtocolError);
  });

  it("checks PKCE S256 without exposing the verifier", () => {
    const verifier = "a-safe-pkce-verifier-for-a-public-client-123456789";
    const challenge = createHash("sha256").update(verifier).digest("base64url");
    expect(verifyPkceS256(verifier, challenge)).toBe(true);
    expect(verifyPkceS256("different-verifier", challenge)).toBe(false);
  });

  it("hashes opaque secrets deterministically", () => {
    expect(hashOpaqueSecret("token")).toBe(hashOpaqueSecret("token"));
    expect(hashOpaqueSecret("token")).not.toBe(hashOpaqueSecret("other-token"));
  });
});
