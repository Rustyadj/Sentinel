import { beforeEach, describe, expect, it, vi } from "vitest";

const prisma = vi.hoisted(() => ({ create: vi.fn() }));
vi.mock("@/lib/db", () => ({ db: { externalClient: { create: prisma.create } } }));
vi.mock("@/lib/redis", () => ({ redisIncrementWithExpiry: vi.fn(async () => 1) }));

import { registerClientDynamically } from "@/lib/integrations/registration";
import { OAuthProtocolError } from "@/lib/integrations/oauth";

const ALL = ["sentinel.read", "sentinel.tasks.read", "sentinel.tasks.write", "sentinel.memory.read"];

beforeEach(() => {
  prisma.create.mockReset();
  prisma.create.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({
    ...data,
    createdAt: new Date("2026-09-17T05:00:00Z"),
  }));
});

const CHATGPT_REDIRECT = "https://chatgpt.com/connector/oauth/abc123";

describe("dynamic client registration", () => {
  it("registers a client with the exact redirect URI it supplied", async () => {
    const result = await registerClientDynamically({
      client_name: "ChatGPT",
      redirect_uris: [CHATGPT_REDIRECT],
    });

    expect(result.client_id).toMatch(/^dcr-/);
    expect(result.redirect_uris).toEqual([CHATGPT_REDIRECT]);
    expect(result.grant_types).toEqual(["authorization_code"]);
    expect(result.response_types).toEqual(["code"]);
    // Omitting scope means the full advertised set -- a ceiling, not a grant.
    expect(result.scope.split(" ").sort()).toEqual([...ALL].sort());
  });

  it("stores no creating user, because registration is unauthenticated", async () => {
    await registerClientDynamically({ redirect_uris: [CHATGPT_REDIRECT] });
    expect(prisma.create.mock.calls[0][0].data.createdByUserId).toBeNull();
  });

  it("stores the client secret only as a hash and returns it once", async () => {
    const result = await registerClientDynamically({ redirect_uris: [CHATGPT_REDIRECT] });
    const stored = prisma.create.mock.calls[0][0].data.clientSecretHash as string;
    expect(result.client_secret).toBeTruthy();
    expect(stored).toBeTruthy();
    expect(stored).not.toBe(result.client_secret);
    expect(result.client_secret_expires_at).toBe(0);
  });

  it("issues a public client with no secret when asked for token_endpoint_auth_method=none", async () => {
    const result = await registerClientDynamically({
      redirect_uris: [CHATGPT_REDIRECT],
      token_endpoint_auth_method: "none",
    });
    expect(result.client_secret).toBeUndefined();
    expect(result.token_endpoint_auth_method).toBe("none");
    expect(prisma.create.mock.calls[0][0].data.clientSecretHash).toBeNull();
  });

  it("refuses wildcard redirect URIs", async () => {
    await expect(registerClientDynamically({ redirect_uris: ["https://chatgpt.com/*"] })).rejects.toBeInstanceOf(
      OAuthProtocolError,
    );
    expect(prisma.create).not.toHaveBeenCalled();
  });

  it("refuses plaintext http except on loopback", async () => {
    await expect(registerClientDynamically({ redirect_uris: ["http://evil.example/cb"] })).rejects.toBeInstanceOf(
      OAuthProtocolError,
    );
    await expect(registerClientDynamically({ redirect_uris: ["http://127.0.0.1:8080/cb"] })).resolves.toMatchObject({
      redirect_uris: ["http://127.0.0.1:8080/cb"],
    });
  });

  it("refuses a redirect URI with a fragment or a non-URL value", async () => {
    await expect(registerClientDynamically({ redirect_uris: ["https://a.example/cb#x"] })).rejects.toBeInstanceOf(
      OAuthProtocolError,
    );
    await expect(registerClientDynamically({ redirect_uris: ["not-a-url"] })).rejects.toBeInstanceOf(OAuthProtocolError);
  });

  it("requires at least one redirect URI and caps how many", async () => {
    await expect(registerClientDynamically({ redirect_uris: [] })).rejects.toBeInstanceOf(OAuthProtocolError);
    await expect(registerClientDynamically({})).rejects.toBeInstanceOf(OAuthProtocolError);
    const many = Array.from({ length: 6 }, (_, i) => `https://a.example/cb${i}`);
    await expect(registerClientDynamically({ redirect_uris: many })).rejects.toBeInstanceOf(OAuthProtocolError);
  });

  it("rejects an unknown scope rather than silently dropping it", async () => {
    await expect(
      registerClientDynamically({ redirect_uris: [CHATGPT_REDIRECT], scope: "sentinel.read sentinel.admin" }),
    ).rejects.toMatchObject({ code: "invalid_scope" });
    expect(prisma.create).not.toHaveBeenCalled();
  });

  it("clamps allowed scopes to what the client actually asked for", async () => {
    const result = await registerClientDynamically({
      redirect_uris: [CHATGPT_REDIRECT],
      scope: "sentinel.read sentinel.memory.read",
    });
    expect(result.scope).toBe("sentinel.read sentinel.memory.read");
    expect(prisma.create.mock.calls[0][0].data.allowedScopes).toEqual(["sentinel.read", "sentinel.memory.read"]);
  });

  // RFC 7591 3.2.1: register with the supported subset and echo back what was
  // actually granted. Rejecting over an unsupported optional grant is what
  // broke the real Codex connector.
  it("grants the refresh_token grant when the client registers for it", async () => {
    const result = await registerClientDynamically({
      redirect_uris: [CHATGPT_REDIRECT],
      grant_types: ["authorization_code", "refresh_token"],
    });
    expect(result.grant_types).toEqual(["authorization_code", "refresh_token"]);
    expect(prisma.create.mock.calls[0][0].data.grantTypes).toEqual(["authorization_code", "refresh_token"]);
  });

  it("does not grant refresh_token to a client that never asked for it", async () => {
    const result = await registerClientDynamically({ redirect_uris: [CHATGPT_REDIRECT] });
    expect(result.grant_types).toEqual(["authorization_code"]);
    expect(prisma.create.mock.calls[0][0].data.grantTypes).toEqual(["authorization_code"]);
  });

  it("still narrows a genuinely unsupported grant type", async () => {
    const result = await registerClientDynamically({
      redirect_uris: [CHATGPT_REDIRECT],
      grant_types: ["authorization_code", "implicit"],
    });
    expect(result.grant_types).toEqual(["authorization_code"]);
  });

  it("registers the exact request Codex sends", async () => {
    const result = await registerClientDynamically({
      client_name: "Codex",
      redirect_uris: ["http://127.0.0.1:33115/callback/3epIrSh57yxr"],
      grant_types: ["authorization_code", "refresh_token"],
      token_endpoint_auth_method: "none",
      response_types: ["code"],
      scope: "sentinel.read sentinel.tasks.read sentinel.tasks.write sentinel.memory.read",
      application_type: "native",
    });
    expect(result.client_id).toMatch(/^dcr-/);
    expect(result.client_secret).toBeUndefined();
    expect(result.token_endpoint_auth_method).toBe("none");
    expect(result.grant_types).toEqual(["authorization_code", "refresh_token"]);
    expect(result.response_types).toEqual(["code"]);
    expect(result.redirect_uris).toEqual(["http://127.0.0.1:33115/callback/3epIrSh57yxr"]);
    expect(result.scope.split(" ").sort()).toEqual([...ALL].sort());
  });

  it("still errors when no requested grant or response type is available", async () => {
    await expect(
      registerClientDynamically({ redirect_uris: [CHATGPT_REDIRECT], grant_types: ["client_credentials"] }),
    ).rejects.toBeInstanceOf(OAuthProtocolError);
    await expect(
      registerClientDynamically({ redirect_uris: [CHATGPT_REDIRECT], response_types: ["token"] }),
    ).rejects.toBeInstanceOf(OAuthProtocolError);
  });

  it("rejects a non-object body", async () => {
    await expect(registerClientDynamically(null)).rejects.toBeInstanceOf(OAuthProtocolError);
    await expect(registerClientDynamically("nope")).rejects.toBeInstanceOf(OAuthProtocolError);
  });
});
