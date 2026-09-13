import { accessErrorResponse } from "@/lib/workspaces/authorization";
import { AGENT_WORKSPACE_PERMISSIONS, requireWorkspaceAccess } from "@/lib/agent-workspaces/authorization";
import { workspaceErrorResponse } from "@/lib/agent-workspaces/errors";
import { readJson, requireString, optionalString, uiActor, serialize } from "@/lib/agent-workspaces/http";
import { listCommands, runCommand } from "@/lib/agent-workspaces/exec";

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    await requireWorkspaceAccess(id, AGENT_WORKSPACE_PERMISSIONS.view);
    const limit = Number.parseInt(new URL(request.url).searchParams.get("limit") ?? "50", 10) || 50;
    return Response.json(serialize({ commands: await listCommands(id, limit) }));
  } catch (error) {
    if (error instanceof Error && error.name === "WorkspaceAccessError") return accessErrorResponse(error);
    return workspaceErrorResponse(error);
  }
}

/** Terminal execution. Every run is bounded, attributed and recorded. */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const { user, workspace } = await requireWorkspaceAccess(id, AGENT_WORKSPACE_PERMISSIONS.execute);
    const body = await readJson(request);
    const result = await runCommand({
      workspace,
      command: requireString(body.command, "command", 16_000),
      cwd: optionalString(body.cwd, "cwd", 4096),
      timeoutMs: typeof body.timeoutMs === "number" ? body.timeoutMs : undefined,
      actor: uiActor(user.id),
    });
    return Response.json(serialize({ result }));
  } catch (error) {
    if (error instanceof Error && error.name === "WorkspaceAccessError") return accessErrorResponse(error);
    return workspaceErrorResponse(error);
  }
}
