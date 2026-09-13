import { accessErrorResponse } from "@/lib/workspaces/authorization";
import { AGENT_WORKSPACE_PERMISSIONS, requireWorkspaceAccess } from "@/lib/agent-workspaces/authorization";
import { workspaceErrorResponse } from "@/lib/agent-workspaces/errors";
import { serialize } from "@/lib/agent-workspaces/http";
import { listWorkspaceEvents } from "@/lib/agent-workspaces/events";

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    await requireWorkspaceAccess(id, AGENT_WORKSPACE_PERMISSIONS.view);
    const limit = Number.parseInt(new URL(request.url).searchParams.get("limit") ?? "100", 10) || 100;
    return Response.json(serialize({ events: await listWorkspaceEvents(id, limit) }));
  } catch (error) {
    if (error instanceof Error && error.name === "WorkspaceAccessError") return accessErrorResponse(error);
    return workspaceErrorResponse(error);
  }
}
