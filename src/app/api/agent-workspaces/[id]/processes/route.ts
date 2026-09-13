import { accessErrorResponse } from "@/lib/workspaces/authorization";
import { AGENT_WORKSPACE_PERMISSIONS, requireWorkspaceAccess } from "@/lib/agent-workspaces/authorization";
import { workspaceErrorResponse } from "@/lib/agent-workspaces/errors";
import { readJson, requireString, optionalString, uiActor, serialize } from "@/lib/agent-workspaces/http";
import { listProcesses, startProcess } from "@/lib/agent-workspaces/processes";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const { workspace } = await requireWorkspaceAccess(id, AGENT_WORKSPACE_PERMISSIONS.view);
    return Response.json(serialize(await listProcesses(workspace)));
  } catch (error) {
    if (error instanceof Error && error.name === "WorkspaceAccessError") return accessErrorResponse(error);
    return workspaceErrorResponse(error);
  }
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const { user, workspace } = await requireWorkspaceAccess(id, AGENT_WORKSPACE_PERMISSIONS.execute);
    const body = await readJson(request);
    const process = await startProcess({
      workspace,
      label: requireString(body.label, "label", 120),
      command: requireString(body.command, "command", 16_000),
      cwd: optionalString(body.cwd, "cwd", 4096),
      ports: Array.isArray(body.ports) ? (body.ports as number[]) : [],
      actor: uiActor(user.id),
    });
    return Response.json(serialize({ process }), { status: 201 });
  } catch (error) {
    if (error instanceof Error && error.name === "WorkspaceAccessError") return accessErrorResponse(error);
    return workspaceErrorResponse(error);
  }
}
