import { NextResponse } from "next/server";
import { errorResponse, HttpError, readBody, requiredString, requireBotAdmin } from "@/lib/bots/api";
import { listMcpCredentialBindings, matchMcpCredentialBinding } from "@/lib/bots/mcp-credentials";
import { loadCatalog, refreshMcpServer, registerMcpServer } from "@/lib/bots/catalog";

export async function GET(request: Request) {
  try {
    const workspaceId = new URL(request.url).searchParams.get("workspaceId");
    if (!workspaceId) throw new HttpError("workspaceId is required", 400);
    await requireBotAdmin(workspaceId);
    return NextResponse.json({ servers: await loadCatalog(workspaceId), credentialBindings: listMcpCredentialBindings(workspaceId) }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return errorResponse(error); }
}

/** Register an outbound MCP server, then discover its tools with a real tools/list call. */
export async function POST(request: Request) {
  try {
    const body = await readBody(request);
    const workspaceId = requiredString(body, "workspaceId");
    const user = await requireBotAdmin(workspaceId);
    const url = requiredString(body, "url");
    if (body.secretEnvVar !== undefined || (body.authMode !== undefined && body.authMode !== "none" && body.authMode !== "bearer-env")) {
      throw new HttpError("Use a configured MCP credential binding for authenticated connections.", 400);
    }
    const bindingId = body.credentialBindingId === undefined ? null : requiredString(body, "credentialBindingId");
    const secretEnvVar = bindingId ? matchMcpCredentialBinding(bindingId, workspaceId, url) : null;
    if ((bindingId || body.authMode === "bearer-env") && !secretEnvVar) {
      throw new HttpError("No deployment credential is bound to this workspace and MCP endpoint.", 400);
    }
    const row = await registerMcpServer({
      workspaceId, name: requiredString(body, "name"), url,
      description: typeof body.description === "string" ? body.description : undefined,
      authMode: secretEnvVar ? "bearer-env" : "none",
      secretEnvVar,
      capabilityTags: Array.isArray(body.capabilityTags) ? body.capabilityTags.map(String) : [],
    }, user.id);
    const discovered = await refreshMcpServer(row.id, workspaceId, user.id);
    return NextResponse.json({ server: { id: discovered.id, name: discovered.name, status: discovered.status, lastError: discovered.lastError, tools: Array.isArray(discovered.tools) ? discovered.tools.length : 0 } }, { status: 201 });
  } catch (error) { return errorResponse(error); }
}
