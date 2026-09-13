import { accessErrorResponse } from "@/lib/workspaces/authorization";
import { AGENT_WORKSPACE_PERMISSIONS, requireWorkspaceAccess } from "@/lib/agent-workspaces/authorization";
import { workspaceErrorResponse } from "@/lib/agent-workspaces/errors";
import { requireString } from "@/lib/agent-workspaces/http";
import { searchFiles } from "@/lib/agent-workspaces/files";

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const { workspace } = await requireWorkspaceAccess(id, AGENT_WORKSPACE_PERMISSIONS.view);
    const url = new URL(request.url);
    const query = requireString(url.searchParams.get("q") ?? undefined, "q", 500);
    const matches = await searchFiles(
      workspace,
      query,
      url.searchParams.get("path") ?? undefined,
      Number.parseInt(url.searchParams.get("limit") ?? "100", 10) || 100,
    );
    return Response.json({ matches });
  } catch (error) {
    if (error instanceof Error && error.name === "WorkspaceAccessError") return accessErrorResponse(error);
    return workspaceErrorResponse(error);
  }
}
