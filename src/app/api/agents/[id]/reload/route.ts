import { NextResponse } from "next/server";
import { isAllowedVpsAgentId, getVpsAgent } from "@/lib/agents/registry";
import { getControlPlaneUser, canRestartAgent, unauthorized, forbidden } from "@/lib/agents/permissions";
import { exec } from "child_process";
import { promisify } from "util";

const execAsync = promisify(exec);

type Params = { params: Promise<{ id: string }> };

// Reload sends SIGHUP to the container process to reload config without full restart.
// Falls back to restart if SIGHUP isn't supported.
export async function POST(_req: Request, { params }: Params) {
  const user = await getControlPlaneUser();
  if (!user) return unauthorized();
  if (!canRestartAgent(user.role)) return forbidden("reload agents");

  const { id } = await params;
  if (!(await isAllowedVpsAgentId(id))) {
    return NextResponse.json({ error: "Agent not found" }, { status: 404 });
  }

  const agent = await getVpsAgent(id);
  if (!agent) return NextResponse.json({ error: "Agent not found" }, { status: 404 });

  try {
    // Try SIGHUP first (graceful reload)
    await execAsync(`docker kill --signal=SIGHUP ${id}`, { timeout: 10000 });
    return NextResponse.json({
      ok: true,
      method: "sighup",
      message: `${agent.name} reloaded via SIGHUP`,
      agentId: id,
      reloadedAt: new Date().toISOString(),
      reloadedBy: user.email,
    });
  } catch {
    // Fall back to restart
    try {
      await execAsync(`docker restart ${id}`, { timeout: 30000 });
      return NextResponse.json({
        ok: true,
        method: "restart",
        message: `${agent.name} reloaded via restart (SIGHUP not supported)`,
        agentId: id,
        reloadedAt: new Date().toISOString(),
        reloadedBy: user.email,
      });
    } catch (err2) {
      return NextResponse.json(
        { ok: false, error: (err2 as Error).message },
        { status: 500 }
      );
    }
  }
}
