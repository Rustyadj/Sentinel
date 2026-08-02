import { NextResponse } from "next/server";
import { ALLOWED_AGENT_IDS, getVpsAgent } from "@/lib/agents/registry";
import { restartContainer } from "@/lib/agents/processControl";
import { RUNTIME_PERMISSIONS, requireRuntimeAccess } from "@/lib/agents/runtime/authorization";
import { runtimeErrorResponse } from "@/lib/agents/runtime/api";
import { writeAuditLog } from "@/lib/workspaces/audit";

type Params = { params: Promise<{ id: string }> };

export async function POST(_req: Request, { params }: Params) {
  try {
    const { id } = await params;
    if (!ALLOWED_AGENT_IDS.has(id)) {
      return NextResponse.json({ error: "Agent not found" }, { status: 404 });
    }
    const { user, runtime } = await requireRuntimeAccess(id, RUNTIME_PERMISSIONS.restart);
    const agent = getVpsAgent(id);
    if (!agent) return NextResponse.json({ error: "Agent not found" }, { status: 404 });
    await restartContainer(id);
    await writeAuditLog({ workspaceId: runtime.workspaceId, userId: user.id, action: "agent_runtime.restarted", entityType: "AgentRuntime", entityId: runtime.id, details: { source: "legacy_route" } });
    return NextResponse.json({
      ok: true,
      message: `${agent.name} restarted`,
      agentId: id,
      restartedAt: new Date().toISOString(),
      restartedBy: user.email,
    });
  } catch (error) {
    return runtimeErrorResponse(error);
  }
}
