import { NextRequest, NextResponse } from "next/server";
import { requireProjectPermission } from "@/lib/workspaces/authorization";
import { projectAgentErrorResponse } from "@/lib/collaboration/http";
import { recheckProjectAgent, removeProjectAgent, rotateProjectAgentToken, updateProjectAgent } from "@/lib/collaboration/project-agents";

type Context = { params: Promise<{ id: string; agentId: string }> };

// Reaching the project is checked here; who may change this particular agent
// (its owner, or whoever manages the project) is decided in the service.
async function scope(context: Context) {
  const { id, agentId } = await context.params;
  const { user, project } = await requireProjectPermission(id, "project.read");
  return { project, agentId, actorId: user.id };
}

export async function PATCH(req: NextRequest, context: Context) {
  try {
    const target = await scope(context);
    const body = (await req.json().catch(() => null)) as { status?: unknown; canMessageOtherOwners?: unknown } | null;
    const status = body?.status === "connected" || body?.status === "disabled" ? body.status : undefined;
    const canMessageOtherOwners = typeof body?.canMessageOtherOwners === "boolean" ? body.canMessageOtherOwners : undefined;
    if (body?.status !== undefined && !status) {
      return NextResponse.json({ error: "status must be connected or disabled" }, { status: 400 });
    }
    await updateProjectAgent({ ...target, status, canMessageOtherOwners });
    return NextResponse.json({ ok: true });
  } catch (error) {
    return projectAgentErrorResponse(error);
  }
}

export async function DELETE(_req: NextRequest, context: Context) {
  try {
    await removeProjectAgent(await scope(context));
    return NextResponse.json({ ok: true });
  } catch (error) {
    return projectAgentErrorResponse(error);
  }
}

/** Actions on one agent: `check` reads its Agent Card again, `rotate-token` issues a new token. */
export async function POST(req: NextRequest, context: Context) {
  try {
    const target = await scope(context);
    const body = (await req.json().catch(() => null)) as { action?: unknown } | null;
    if (body?.action === "check") return NextResponse.json(await recheckProjectAgent(target));
    if (body?.action === "rotate-token") return NextResponse.json({ token: await rotateProjectAgentToken(target) });
    return NextResponse.json({ error: "action must be check or rotate-token" }, { status: 400 });
  } catch (error) {
    return projectAgentErrorResponse(error);
  }
}
