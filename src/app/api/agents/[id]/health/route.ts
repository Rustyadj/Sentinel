import { NextResponse } from "next/server";
import { getVpsAgent } from "@/lib/agents/registry";
import { getControlPlaneUser, canViewAgent, unauthorized } from "@/lib/agents/permissions";

type Params = { params: Promise<{ id: string }> };

export async function GET(_req: Request, { params }: Params) {
  const { id } = await params;
  const user = await getControlPlaneUser(id);
  if (!user || !canViewAgent(user.role)) return unauthorized();
  const agent = getVpsAgent(id);

  if (!agent) {
    return NextResponse.json({ status: "unknown", message: "Agent not found" }, { status: 404 });
  }

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 3000);
    const res = await fetch(agent.endpoint, { signal: controller.signal });
    clearTimeout(timeout);
    return NextResponse.json({
      status: res.ok ? "online" : "degraded",
      statusCode: res.status,
      endpoint: agent.endpoint,
      checkedAt: new Date().toISOString(),
    });
  } catch {
    return NextResponse.json({
      status: "offline",
      endpoint: agent.endpoint,
      checkedAt: new Date().toISOString(),
    });
  }
}
