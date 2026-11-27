import { NextRequest, NextResponse } from "next/server";
import { requireWorkspacePermission } from "@/lib/workspaces/authorization";
import { discoverForAgent } from "@/lib/autonomy/capability-registry";
import { autonomyErrorResponse } from "../_shared";

/**
 * Capability discovery: ?workspaceId&agentId&q=<need>. Each result says
 * whether the agent already holds the authority to use it, and if not,
 * exactly what is missing. Discovery never grants access.
 */
export async function GET(request: NextRequest) {
  try {
    const params = request.nextUrl.searchParams;
    const workspaceId = params.get("workspaceId");
    if (!workspaceId) return NextResponse.json({ error: "workspaceId is required" }, { status: 400 });
    await requireWorkspacePermission(workspaceId, "agents.runtime.view");
    const agentId = params.get("agentId") ?? "hermes-lisa";
    const limit = Math.min(100, Math.max(1, Number(params.get("limit")) || 25));
    return NextResponse.json({ capabilities: await discoverForAgent({ workspaceId, agentId, query: params.get("q") ?? "", limit }) });
  } catch (error) {
    return autonomyErrorResponse(error);
  }
}
