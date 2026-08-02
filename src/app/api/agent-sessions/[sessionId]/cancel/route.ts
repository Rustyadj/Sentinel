import { writeAuditLog } from "@/lib/workspaces/audit";
import { RUNTIME_PERMISSIONS, requireSessionAccess } from "@/lib/agents/runtime/authorization";
import { runtimeErrorResponse } from "@/lib/agents/runtime/api";
import { getRuntimeAdapter } from "@/lib/agents/runtime/service";

export async function POST(_request: Request, { params }: { params: Promise<{ sessionId: string }> }) {
  try {
    const { sessionId } = await params;
    const { user, runtime, session } = await requireSessionAccess(sessionId, RUNTIME_PERMISSIONS.cancel);
    const result = await getRuntimeAdapter(runtime.kind).cancel(sessionId);
    await writeAuditLog({ workspaceId: session.workspaceId, projectId: session.projectId, userId: user.id, action: "agent_runtime.task_cancelled", entityType: "AgentSession", entityId: sessionId, details: { runtimeId: runtime.id, success: result.success } });
    return Response.json({ result }, { status: result.success ? 200 : 409 });
  } catch (error) { return runtimeErrorResponse(error); }
}
