import { db } from "@/lib/db";
import { canUseMcpWorkspace, prismaDataSource } from "@/lib/mcp/data-source";
import { JSON_RPC } from "@/lib/mcp/errors";
import { authenticateBearer, issuerUrl, unauthorizedResponse } from "@/lib/mcp/oauth";
import { handleMessage } from "@/lib/mcp/server";
import { prismaStore } from "@/lib/mcp/store";

/**
 * The external MCP endpoint — Streamable HTTP, the transport ChatGPT and other
 * remote MCP clients speak.
 *
 * Every request carries its own bearer token; there is no session and no
 * server-side stream state, so POST is stateless and any instance can serve
 * any request. GET is answered 405 rather than upgraded: an SSE channel would
 * be server-initiated notifications we have nothing to send on (the tool list
 * is fixed, listChanged is false), and holding those connections open across
 * a container restart buys nothing.
 */
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const principal = await authenticateBearer(prismaStore(db), request.headers.get("authorization"));
  if (!principal) return unauthorizedResponse();
  if (principal.scopes.length === 0) {
    return unauthorizedResponse("This connector's grant no longer carries any scopes.");
  }
  if (!(await canUseMcpWorkspace(principal.userId, principal.workspaceId))) {
    return unauthorizedResponse("Workspace access was removed or the workspace is unavailable.");
  }

  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return Response.json(
      { jsonrpc: "2.0", id: null, error: { code: JSON_RPC.parseError, message: "Invalid JSON." } },
      { status: 400 },
    );
  }

  const response = await handleMessage(payload, {
    principal,
    data: prismaDataSource(),
    baseUrl: issuerUrl(),
  });

  // A batch of nothing but notifications produces no body; 202 is the MCP
  // spec's answer for "accepted, nothing to return".
  if (response === null) return new Response(null, { status: 202 });
  return Response.json(response, { headers: { "Cache-Control": "no-store" } });
}

export async function GET() {
  return new Response("This MCP endpoint accepts POST only.", { status: 405, headers: { Allow: "POST" } });
}

export async function DELETE() {
  return new Response(null, { status: 405, headers: { Allow: "POST" } });
}
