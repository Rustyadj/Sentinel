import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { NextRequest, NextResponse } from "next/server";
import { authenticateAccessToken } from "@/lib/integrations/oauth";
import { enforceMcpRateLimit } from "@/lib/integrations/rate-limit";
import { createSentinelMcpServer } from "@/lib/integrations/mcp-server";

export const runtime = "nodejs";

function unauthorized(request: NextRequest) {
  const resource = `${request.nextUrl.origin}/.well-known/oauth-protected-resource/mcp`;
  return new NextResponse("Unauthorized", { status: 401, headers: { "WWW-Authenticate": `Bearer resource_metadata="${resource}"` } });
}

async function handle(request: NextRequest) {
  const principal = await authenticateAccessToken(request.headers.get("authorization"));
  if (!principal) return unauthorized(request);
  try {
    await enforceMcpRateLimit(principal.clientId, principal.userId);
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "MCP request rejected." }, { status: 429 });
  }
  const transport = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
  const server = createSentinelMcpServer(principal);
  await server.connect(transport);
  const response = await transport.handleRequest(request, { authInfo: { token: "redacted", clientId: principal.clientId, scopes: principal.scopes, extra: { userId: principal.userId } } });
  await server.close();
  return response;
}

export const GET = handle;
export const POST = handle;
export const DELETE = handle;
