import { NextResponse } from "next/server";
import { isAllowedVpsAgentId } from "@/lib/agents/registry";
import { getControlPlaneUser, canViewAgent, unauthorized } from "@/lib/agents/permissions";
import { listConfigFiles } from "@/lib/agents/configEditor";

type Params = { params: Promise<{ id: string }> };

export async function GET(_req: Request, { params }: Params) {
  const user = await getControlPlaneUser();
  if (!user || !canViewAgent(user.role)) return unauthorized();

  const { id } = await params;
  if (!(await isAllowedVpsAgentId(id))) {
    return NextResponse.json({ error: "Agent not found" }, { status: 404 });
  }

  const files = await listConfigFiles(id);
  return NextResponse.json({ files, agentId: id });
}
