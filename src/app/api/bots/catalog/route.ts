import { NextResponse } from "next/server";
import { errorResponse, HttpError, readBody, requiredString, requireBotAdmin } from "@/lib/bots/api";
import { loadCatalog, refreshMcpServer, registerMcpServer } from "@/lib/bots/catalog";

export async function GET(request: Request) {
  try {
    const workspaceId = new URL(request.url).searchParams.get("workspaceId");
    if (!workspaceId) throw new HttpError("workspaceId is required", 400);
    await requireBotAdmin(workspaceId);
    return NextResponse.json({ servers: await loadCatalog(workspaceId) });
  } catch (error) { return errorResponse(error); }
}

/** Register an outbound MCP server, then discover its tools with a real tools/list call. */
export async function POST(request: Request) {
  try {
    const body = await readBody(request);
    const workspaceId = requiredString(body, "workspaceId");
    const user = await requireBotAdmin(workspaceId);
    const row = await registerMcpServer({
      workspaceId, name: requiredString(body, "name"), url: requiredString(body, "url"),
      description: typeof body.description === "string" ? body.description : undefined,
      authMode: body.authMode === "bearer-env" ? "bearer-env" : "none",
      secretEnvVar: typeof body.secretEnvVar === "string" ? body.secretEnvVar : null,
      capabilityTags: Array.isArray(body.capabilityTags) ? body.capabilityTags.map(String) : [],
    }, user.id);
    const discovered = await refreshMcpServer(row.id, workspaceId, user.id);
    return NextResponse.json({ server: { id: discovered.id, name: discovered.name, status: discovered.status, lastError: discovered.lastError, tools: Array.isArray(discovered.tools) ? discovered.tools.length : 0 } }, { status: 201 });
  } catch (error) { return errorResponse(error); }
}
