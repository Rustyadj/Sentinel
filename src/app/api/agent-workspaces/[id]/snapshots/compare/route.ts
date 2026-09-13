import { accessErrorResponse } from "@/lib/workspaces/authorization";
import { AGENT_WORKSPACE_PERMISSIONS, requireWorkspaceAccess } from "@/lib/agent-workspaces/authorization";
import { workspaceErrorResponse } from "@/lib/agent-workspaces/errors";
import { requireString, serialize } from "@/lib/agent-workspaces/http";
import { compareSnapshots } from "@/lib/agent-workspaces/snapshots";

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    await requireWorkspaceAccess(id, AGENT_WORKSPACE_PERMISSIONS.view);
    const url = new URL(request.url);
    const left = requireString(url.searchParams.get("left") ?? undefined, "left", 200);
    const right = requireString(url.searchParams.get("right") ?? undefined, "right", 200);
    return Response.json(serialize(await compareSnapshots(id, left, right)));
  } catch (error) {
    if (error instanceof Error && error.name === "WorkspaceAccessError") return accessErrorResponse(error);
    return workspaceErrorResponse(error);
  }
}
