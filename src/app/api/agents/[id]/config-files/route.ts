import { NextResponse } from "next/server";
import { ALLOWED_AGENT_IDS } from "@/lib/agents/registry";
import { getControlPlaneUser, canViewAgent, unauthorized } from "@/lib/agents/permissions";
import { listConfigFiles } from "@/lib/agents/configEditor";

type Params = { params: Promise<{ id: string }> };

export async function GET(_req: Request, { params }: Params) {
  const { id } = await params;
  const user = await getControlPlaneUser(id);
  if (!user || !canViewAgent(user.role)) return unauthorized();
  if (!ALLOWED_AGENT_IDS.has(id)) {
    return NextResponse.json({ error: "Agent not found" }, { status: 404 });
  }

  const files = await listConfigFiles(id);
  return NextResponse.json({ files, agentId: id });
}
