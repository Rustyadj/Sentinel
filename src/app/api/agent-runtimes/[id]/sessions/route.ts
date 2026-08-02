import { writeAuditLog } from "@/lib/workspaces/audit";
import { RUNTIME_PERMISSIONS, requireRuntimeAccess, validateSessionScope } from "@/lib/agents/runtime/authorization";
import { parseLimit, readJsonObject, runtimeErrorResponse } from "@/lib/agents/runtime/api";
import { getRuntimeAdapter } from "@/lib/agents/runtime/service";
import { RuntimeError } from "@/lib/agents/runtime/errors";

type Context = { params: Promise<{ id: string }> };

export async function POST(request: Request, { params }: Context) {
  try {
    const { id } = await params;
    const { user, runtime } = await requireRuntimeAccess(id, RUNTIME_PERMISSIONS.execute);
    const body = await readJsonObject(request);
    const workspaceId = typeof body.workspaceId === "string" ? body.workspaceId : undefined;
    const projectId = typeof body.projectId === "string" ? body.projectId : undefined;
    await validateSessionScope(runtime, user.id, { workspaceId, projectId });
    if (body.initialPrompt !== undefined && typeof body.initialPrompt !== "string") {
      throw new RuntimeError("initialPrompt must be a string", "invalid_body", 400);
    }
    const session = await getRuntimeAdapter(runtime.kind).startSession({
      runtimeId: runtime.id,
      userId: user.id,
      workspaceId,
      projectId,
      workingDirectory: typeof body.workingDirectory === "string" ? body.workingDirectory : undefined,
      initialPrompt: typeof body.initialPrompt === "string" ? body.initialPrompt : undefined,
    });
    await writeAuditLog({
      workspaceId, projectId, userId: user.id, action: "agent_runtime.session_started",
      entityType: "AgentSession", entityId: session.id, details: { runtimeId: runtime.id, kind: runtime.kind },
    });
    return Response.json({ session }, { status: 201 });
  } catch (error) {
    return runtimeErrorResponse(error);
  }
}

export async function GET(request: Request, { params }: Context) {
  try {
    const { id } = await params;
    const { runtime } = await requireRuntimeAccess(id, RUNTIME_PERMISSIONS.view);
    const url = new URL(request.url);
    const sessions = await getRuntimeAdapter(runtime.kind).listSessions({
      runtimeId: runtime.id,
      status: url.searchParams.get("status") ?? undefined,
      limit: parseLimit(url.searchParams.get("limit")),
    });
    return Response.json({ sessions });
  } catch (error) {
    return runtimeErrorResponse(error);
  }
}
