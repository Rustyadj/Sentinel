import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { NextRequest, NextResponse } from "next/server";
import { authenticateAccessToken } from "@/lib/integrations/oauth";
import { enforceMcpRateLimit } from "@/lib/integrations/rate-limit";
import { createSentinelMcpServer } from "@/lib/integrations/mcp-server";
import { publicOrigin } from "@/lib/integrations/public-origin";
import { writeAuditLog } from "@/lib/workspaces/audit";

export const runtime = "nodejs";

function unauthorized(request: NextRequest) {
  const resource = `${publicOrigin(request)}/.well-known/oauth-protected-resource/mcp`;
  return new NextResponse("Unauthorized", { status: 401, headers: { "WWW-Authenticate": `Bearer resource_metadata="${resource}"` } });
}

async function handle(request: NextRequest) {
  const principal = await authenticateAccessToken(request.headers.get("authorization"));
  if (!principal) return unauthorized(request);
  try {
    await enforceMcpRateLimit(principal.clientId, principal.userId);
  } catch (error) {
    const message = error instanceof Error ? error.message : "MCP request rejected.";
    return NextResponse.json({ error: message }, { status: message.includes("unavailable") ? 503 : 429 });
  }
  const rpc = request.method === "POST" ? await request.clone().json().catch(() => null) as { method?: unknown } | null : null;
  const method = typeof rpc?.method === "string" ? rpc.method : null;
  if (method) {
    await writeAuditLog({
      userId: principal.userId,
      action: "mcp.invocation",
      entityType: "external_client",
      entityId: principal.externalClientId,
      details: { clientId: principal.clientId, method },
    });
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
