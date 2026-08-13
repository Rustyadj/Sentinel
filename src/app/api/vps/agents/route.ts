import { NextResponse } from "next/server";
import { getAllVpsAgents } from "@/lib/agents/registry";
import { getControlPlaneUser, canViewAgent, unauthorized } from "@/lib/agents/permissions";

export async function GET() {
  const user = await getControlPlaneUser();
  if (!user || !canViewAgent(user.role)) return unauthorized();

  const agents = getAllVpsAgents();
  // Never send configPath/logPath to client
  return NextResponse.json(
    agents.map(({ configPath: _cp, logPath: _lp, ...rest }) => rest)
  );
}
