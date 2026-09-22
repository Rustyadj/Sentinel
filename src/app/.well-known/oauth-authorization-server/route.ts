import { NextRequest, NextResponse } from "next/server";
import { MCP_SCOPES } from "@/lib/integrations/oauth";
import { publicOrigin } from "@/lib/integrations/public-origin";

export const dynamic = "force-dynamic";

export function GET(request: NextRequest) {
  const issuer = publicOrigin(request);
  return NextResponse.json({
    issuer,
    authorization_endpoint: `${issuer}/api/integrations/oauth/authorize`,
    token_endpoint: `${issuer}/api/integrations/oauth/token`,
    registration_endpoint: `${issuer}/api/integrations/oauth/register`,
    response_types_supported: ["code"],
    grant_types_supported: ["authorization_code", "refresh_token"],
    code_challenge_methods_supported: ["S256"],
    scopes_supported: MCP_SCOPES,
    token_endpoint_auth_methods_supported: ["none", "client_secret_post"],
  }, {
    headers: {
      "Cache-Control": "public, max-age=300",
      "Access-Control-Allow-Origin": "*",
    },
  });
}
