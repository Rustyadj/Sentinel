import { writeAuditLog } from "@/lib/workspaces/audit";
import { RUNTIME_PERMISSIONS, requireSessionAccess } from "@/lib/agents/runtime/authorization";
import { runtimeErrorResponse } from "@/lib/agents/runtime/api";
import { RuntimeError } from "@/lib/agents/runtime/errors";
import { getRuntimeAdapter } from "@/lib/agents/runtime/service";
import { db } from "@/lib/db";
import { toAgentSession } from "@/lib/agents/runtime/store";

export async function POST(_request: Request, { params }: { params: Promise<{ sessionId: string }> }) {
  try {
    const { sessionId } = await params;
    const { user, runtime, session } = await requireSessionAccess(sessionId, RUNTIME_PERMISSIONS.execute);
    if (!session.externalSessionId) throw new RuntimeError("Session has no provider resume identifier", "resume_unavailable", 422);
    const resumed = await getRuntimeAdapter(runtime.kind).resumeSession({ runtimeId: runtime.id, externalSessionId: session.externalSessionId, userId: user.id });
    const scoped = await db.agentSession.update({
      where: { id: resumed.id },
      data: {
        workspaceId: session.workspaceId ?? null,
        projectId: session.projectId ?? null,
      },
    });
    await writeAuditLog({ workspaceId: session.workspaceId, projectId: session.projectId, userId: user.id, action: "agent_runtime.session_resumed", entityType: "AgentSession", entityId: resumed.id, details: { sourceSessionId: sessionId, runtimeId: runtime.id } });
    return Response.json({ session: toAgentSession(scoped) }, { status: 201 });
  } catch (error) { return runtimeErrorResponse(error); }
}
