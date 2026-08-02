import { NextResponse } from "next/server";
import { ALLOWED_AGENT_IDS, getVpsAgent } from "@/lib/agents/registry";
import { reloadContainer, restartContainer } from "@/lib/agents/processControl";
import { RUNTIME_PERMISSIONS, requireRuntimeAccess } from "@/lib/agents/runtime/authorization";
import { runtimeErrorResponse } from "@/lib/agents/runtime/api";
import { writeAuditLog } from "@/lib/workspaces/audit";

type Params = { params: Promise<{ id: string }> };

// Reload sends SIGHUP to the container process to reload config without full restart.
// Falls back to restart if SIGHUP isn't supported.
export async function POST(_req: Request, { params }: Params) {
  try {
    const { id } = await params;
    if (!ALLOWED_AGENT_IDS.has(id)) {
      return NextResponse.json({ error: "Agent not found" }, { status: 404 });
    }
    const { user, runtime } = await requireRuntimeAccess(id, RUNTIME_PERMISSIONS.restart);
    const agent = getVpsAgent(id);
    if (!agent) return NextResponse.json({ error: "Agent not found" }, { status: 404 });
    let method = "sighup";
    try {
      await reloadContainer(id);
    } catch {
      await restartContainer(id);
      method = "restart";
    }
    await writeAuditLog({ workspaceId: runtime.workspaceId, userId: user.id, action: "agent_runtime.reloaded", entityType: "AgentRuntime", entityId: runtime.id, details: { source: "legacy_route", method } });
    return NextResponse.json({
      ok: true,
      method,
      message: method === "sighup" ? `${agent.name} reloaded via SIGHUP` : `${agent.name} reloaded via restart (SIGHUP not supported)`,
      agentId: id,
      reloadedAt: new Date().toISOString(),
      reloadedBy: user.email,
    });
  } catch (error) {
    return runtimeErrorResponse(error);
  }
}
