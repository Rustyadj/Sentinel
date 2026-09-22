import { NextRequest, NextResponse } from "next/server";
import { MCP_SCOPES } from "@/lib/integrations/oauth";
import { publicOrigin } from "@/lib/integrations/public-origin";

export const dynamic = "force-dynamic";

export function GET(request: NextRequest) {
  const origin = publicOrigin(request);
  return NextResponse.json({
    resource: `${origin}/api/mcp`,
    authorization_servers: [origin],
    scopes_supported: MCP_SCOPES,
    bearer_methods_supported: ["header"],
  }, {
    headers: {
      "Cache-Control": "public, max-age=300",
      "Access-Control-Allow-Origin": "*",
    },
  });
}
