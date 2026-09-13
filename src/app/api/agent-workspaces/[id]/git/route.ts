import { accessErrorResponse } from "@/lib/workspaces/authorization";
import { AGENT_WORKSPACE_PERMISSIONS, requireWorkspaceAccess } from "@/lib/agent-workspaces/authorization";
import { workspaceErrorResponse } from "@/lib/agent-workspaces/errors";
import { readJson, requireString, optionalString, uiActor, serialize } from "@/lib/agent-workspaces/http";
import { runGit, type GitOperation } from "@/lib/agent-workspaces/git";

const READ_ONLY: GitOperation[] = ["status", "diff", "log", "branch"];

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const body = await readJson(request);
    const operation = requireString(body.operation, "operation", 20) as GitOperation;
    const permission = READ_ONLY.includes(operation) && !body.branch
      ? AGENT_WORKSPACE_PERMISSIONS.view
      : AGENT_WORKSPACE_PERMISSIONS.execute;
    const { user, workspace } = await requireWorkspaceAccess(id, permission);

    const result = await runGit({
      workspace,
      operation,
      path: optionalString(body.path, "path", 4096),
      remoteUrl: optionalString(body.remoteUrl, "remoteUrl", 2000),
      directory: optionalString(body.directory, "directory", 4096),
      branch: optionalString(body.branch, "branch", 200),
      message: optionalString(body.message, "message", 4000),
      addAll: body.addAll === true,
      actor: uiActor(user.id),
    });
    return Response.json(serialize({ result }));
  } catch (error) {
    if (error instanceof Error && error.name === "WorkspaceAccessError") return accessErrorResponse(error);
    return workspaceErrorResponse(error);
  }
}
