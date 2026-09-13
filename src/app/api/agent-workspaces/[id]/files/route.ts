import { accessErrorResponse } from "@/lib/workspaces/authorization";
import { AGENT_WORKSPACE_PERMISSIONS, requireWorkspaceAccess } from "@/lib/agent-workspaces/authorization";
import { WorkspaceError, workspaceErrorResponse } from "@/lib/agent-workspaces/errors";
import { readJson, requireString, optionalString, uiActor } from "@/lib/agent-workspaces/http";
import { copyPath, deletePath, listFiles, movePath, readFile, writeFile } from "@/lib/agent-workspaces/files";

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const { workspace } = await requireWorkspaceAccess(id, AGENT_WORKSPACE_PERMISSIONS.view);
    const url = new URL(request.url);
    const path = url.searchParams.get("path") ?? undefined;
    if (url.searchParams.get("mode") === "read") {
      return Response.json(await readFile(workspace, requireString(path, "path", 4096)));
    }
    return Response.json(await listFiles(workspace, path));
  } catch (error) {
    if (error instanceof Error && error.name === "WorkspaceAccessError") return accessErrorResponse(error);
    return workspaceErrorResponse(error);
  }
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const { user, workspace } = await requireWorkspaceAccess(id, AGENT_WORKSPACE_PERMISSIONS.write);
    const body = await readJson(request);
    const encoding = body.encoding === "base64" ? "base64" : "utf8";
    const content = typeof body.content === "string" ? body.content : "";
    const result = await writeFile(workspace, requireString(body.path, "path", 4096), content, encoding, uiActor(user.id));
    return Response.json(result, { status: 201 });
  } catch (error) {
    if (error instanceof Error && error.name === "WorkspaceAccessError") return accessErrorResponse(error);
    return workspaceErrorResponse(error);
  }
}

/** Move or copy. The operation is explicit; there is no inferred default. */
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const { user, workspace } = await requireWorkspaceAccess(id, AGENT_WORKSPACE_PERMISSIONS.write);
    const body = await readJson(request);
    const operation = requireString(body.operation, "operation", 20);
    const from = requireString(body.from, "from", 4096);
    const to = requireString(body.to, "to", 4096);
    const actor = uiActor(user.id);
    if (operation === "move") return Response.json(await movePath(workspace, from, to, actor));
    if (operation === "copy") return Response.json(await copyPath(workspace, from, to, actor));
    throw new WorkspaceError('"operation" must be "move" or "copy".', "invalid_body");
  } catch (error) {
    if (error instanceof Error && error.name === "WorkspaceAccessError") return accessErrorResponse(error);
    return workspaceErrorResponse(error);
  }
}

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const { user, workspace } = await requireWorkspaceAccess(id, AGENT_WORKSPACE_PERMISSIONS.write);
    const url = new URL(request.url);
    const path = requireString(url.searchParams.get("path") ?? undefined, "path", 4096);
    await deletePath(workspace, path, url.searchParams.get("recursive") === "true", uiActor(user.id));
    return Response.json({ ok: true, path: optionalString(path, "path", 4096) });
  } catch (error) {
    if (error instanceof Error && error.name === "WorkspaceAccessError") return accessErrorResponse(error);
    return workspaceErrorResponse(error);
  }
}
