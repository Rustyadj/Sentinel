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
  const resource = `${publicOrigin(request)}/api/mcp`;
  const principal = await authenticateAccessToken(request.headers.get("authorization"), resource);
  if (!principal) return unauthorized(request);
  try {
    await enforceMcpRateLimit(principal.clientId, principal.userId);
  } catch (error) {
    const message = error instanceof Error ? error.message : "MCP request rejected.";
    return NextResponse.json({ error: message }, { status: message.includes("unavailable") ? 503 : 429 });
  }
  const rpc = request.method === "POST" ? await request.clone().json().catch(() => null) as {
    method?: unknown;
    params?: { name?: unknown; arguments?: unknown };
  } | null : null;
  const method = typeof rpc?.method === "string" ? rpc.method : null;
  const transport = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
  const server = createSentinelMcpServer(principal);
  await server.connect(transport);
  const response = await transport.handleRequest(request, { authInfo: { token: "redacted", clientId: principal.clientId, scopes: principal.scopes, extra: { userId: principal.userId } } });
  await server.close();
  if (method) {
    const tool = method === "tools/call" && typeof rpc?.params?.name === "string" ? rpc.params.name : null;
    const args = rpc?.params?.arguments && typeof rpc.params.arguments === "object" && !Array.isArray(rpc.params.arguments)
      ? rpc.params.arguments as Record<string, unknown>
      : {};
    const body = await response.clone().json().catch(() => null) as {
      error?: { code?: unknown };
      result?: { isError?: unknown; structuredContent?: { task?: { id?: unknown }; taskId?: unknown; scope?: { projectId?: unknown; workspaceId?: unknown } } };
    } | null;
    const structured = body?.result?.structuredContent;
    const executionId = typeof structured?.task?.id === "string"
      ? structured.task.id
      : typeof structured?.taskId === "string"
        ? structured.taskId
        : typeof args.taskId === "string"
          ? args.taskId
          : null;
    const projectId = typeof structured?.scope?.projectId === "string"
      ? structured.scope.projectId
      : typeof args.projectId === "string" ? args.projectId : null;
    const workspaceId = typeof structured?.scope?.workspaceId === "string"
      ? structured.scope.workspaceId
      : typeof args.workspaceId === "string" ? args.workspaceId : null;
    const failed = Boolean(body?.error || body?.result?.isError) || response.status >= 400;
    await writeAuditLog({
      userId: principal.userId,
      workspaceId,
      projectId,
      action: tool ? "mcp.tool.invoked" : "mcp.rpc.invoked",
      entityType: executionId ? "orchestration_run" : "external_client",
      entityId: executionId ?? principal.externalClientId,
      details: {
        clientId: principal.clientId,
        method,
        ...(tool ? { tool } : {}),
        scopes: principal.scopes,
        success: !failed,
        ...(typeof body?.error?.code === "number" || typeof body?.error?.code === "string" ? { errorCode: body.error.code } : {}),
        ...(executionId ? { executionId } : {}),
      },
    });
  }
  return response;
}

export const GET = handle;
export const POST = handle;
export const DELETE = handle;
