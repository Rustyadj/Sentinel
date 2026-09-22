import { beforeAll, describe, expect, it } from "vitest";
import { NextRequest } from "next/server";

import { GET as authorizationMetadata } from "@/app/.well-known/oauth-authorization-server/route";
import { GET as resourceMetadata } from "@/app/.well-known/oauth-protected-resource/mcp/route";
import { POST as canonicalRegister } from "@/app/api/integrations/oauth/register/route";
import { POST as canonicalToken } from "@/app/api/integrations/oauth/token/route";
import { POST as legacyRegister } from "@/app/api/mcp/oauth/register/route";
import { POST as legacyToken } from "@/app/api/mcp/oauth/token/route";
import { GET as legacyAuthorize } from "@/app/mcp/authorize/route";
import { MCP_SCOPES } from "@/lib/integrations/oauth";

const ORIGIN = "https://sentinel.example";

beforeAll(() => {
  process.env.AUTH_URL = ORIGIN;
});

describe("canonical ChatGPT MCP surface", () => {
  it("advertises only the SDK-backed OAuth endpoints and scopes", async () => {
    const request = new NextRequest(`${ORIGIN}/.well-known/oauth-authorization-server`);
    const response = authorizationMetadata(request);
    const body = await response.json();

    expect(body).toMatchObject({
      issuer: ORIGIN,
      authorization_endpoint: `${ORIGIN}/api/integrations/oauth/authorize`,
      token_endpoint: `${ORIGIN}/api/integrations/oauth/token`,
      registration_endpoint: `${ORIGIN}/api/integrations/oauth/register`,
      scopes_supported: MCP_SCOPES,
    });
  });

  it("binds protected-resource metadata to the public MCP endpoint", async () => {
    const request = new NextRequest(`${ORIGIN}/.well-known/oauth-protected-resource/mcp`);
    const response = resourceMetadata(request);
    await expect(response.json()).resolves.toMatchObject({
      resource: `${ORIGIN}/api/mcp`,
      authorization_servers: [ORIGIN],
      scopes_supported: MCP_SCOPES,
    });
  });

  it("keeps legacy registration and token URLs as aliases, not implementations", () => {
    expect(legacyRegister).toBe(canonicalRegister);
    expect(legacyToken).toBe(canonicalToken);
  });

  it("redirects the retired authorization URL without losing OAuth parameters", () => {
    const request = new NextRequest(`${ORIGIN}/mcp/authorize?client_id=chatgpt&state=abc&code_challenge=xyz`);
    const response = legacyAuthorize(request);
    const location = new URL(response.headers.get("location")!);

    expect(response.status).toBe(307);
    expect(location.pathname).toBe("/api/integrations/oauth/authorize");
    expect(location.searchParams.get("client_id")).toBe("chatgpt");
    expect(location.searchParams.get("state")).toBe("abc");
    expect(location.searchParams.get("code_challenge")).toBe("xyz");
  });
});
