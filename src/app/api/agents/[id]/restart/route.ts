import { NextResponse } from "next/server";
import { ALLOWED_AGENT_IDS, getVpsAgent } from "@/lib/agents/registry";
import { getControlPlaneUser, canRestartAgent, unauthorized, forbidden } from "@/lib/agents/permissions";
import { restartContainer } from "@/lib/agents/processControl";

type Params = { params: Promise<{ id: string }> };

export async function POST(_req: Request, { params }: Params) {
  const { id } = await params;
  const user = await getControlPlaneUser(id);
  if (!user) return unauthorized();
  if (!canRestartAgent(user.role)) return forbidden("restart agents");
  if (!ALLOWED_AGENT_IDS.has(id)) {
    return NextResponse.json({ error: "Agent not found" }, { status: 404 });
  }

  const agent = getVpsAgent(id);
  if (!agent) return NextResponse.json({ error: "Agent not found" }, { status: 404 });

  try {
    await restartContainer(id);
    return NextResponse.json({
      ok: true,
      message: `${agent.name} restarted`,
      agentId: id,
      restartedAt: new Date().toISOString(),
      restartedBy: user.email,
    });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: (err as Error).message },
      { status: 500 }
    );
  }
}
