import { writeAuditLog } from "@/lib/workspaces/audit";
import { RUNTIME_PERMISSIONS, requireRuntimeAccess } from "@/lib/agents/runtime/authorization";
import { runtimeErrorResponse } from "@/lib/agents/runtime/api";
import { getRuntimeAdapter } from "@/lib/agents/runtime/service";

export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const { user, runtime } = await requireRuntimeAccess(id, RUNTIME_PERMISSIONS.restart);
    const result = await getRuntimeAdapter(runtime.kind).reload(runtime.id);
    await writeAuditLog({ workspaceId: runtime.workspaceId, userId: user.id, action: "agent_runtime.reloaded", entityType: "AgentRuntime", entityId: runtime.id, details: { kind: runtime.kind, success: result.success } });
    return Response.json({ result });
  } catch (error) { return runtimeErrorResponse(error); }
}
