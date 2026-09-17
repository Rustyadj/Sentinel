import { NextRequest, NextResponse } from "next/server";
import { publicOrigin } from "@/lib/integrations/public-origin";

export function GET(request: NextRequest) {
  const issuer = publicOrigin(request);
  return NextResponse.json({
    issuer,
    authorization_endpoint: `${issuer}/api/integrations/oauth/authorize`,
    token_endpoint: `${issuer}/api/integrations/oauth/token`,
    // Without this, an MCP client that holds no credentials has no way to
    // obtain a client_id and aborts after discovery -- which is exactly how
    // the ChatGPT/Codex connector failed before DCR existed.
    registration_endpoint: `${issuer}/api/integrations/oauth/register`,
    response_types_supported: ["code"],
    grant_types_supported: ["authorization_code", "refresh_token"],
    code_challenge_methods_supported: ["S256"],
    scopes_supported: ["sentinel.read", "sentinel.tasks.read", "sentinel.tasks.write", "sentinel.memory.read"],
    token_endpoint_auth_methods_supported: ["none", "client_secret_post"],
  }, { headers: { "Cache-Control": "public, max-age=300" } });
}
