import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/current-user";
import { startExperience, listAgentExperiences } from "@/lib/neural-engine/experience-service";
import { requireAdaptiveScope } from "@/lib/adaptive-memory/scope";
import { db } from "@/lib/db";

export async function POST(req: NextRequest) {
  try {
    const user = await requireUser();
    const body = await req.json();
    if (!body?.agentId || !body?.objective) {
      return NextResponse.json(
        { error: "agentId and objective are required" },
        { status: 400 },
      );
    }
    await requireAdaptiveScope({ actorUserId: user.id, organizationId: body.organizationId,
      workspaceId: body.workspaceId, projectId: body.projectId, permission: "agent.delegate" });
    const experience = await startExperience({ ...body, actingUserId: user.id });
    return NextResponse.json(experience, { status: 201 });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}

export async function GET(req: NextRequest) {
  try {
    const user = await requireUser();
    const agentId = req.nextUrl.searchParams.get("agentId");
    if (!agentId) {
      return NextResponse.json({ error: "agentId is required" }, { status: 400 });
    }
    const limit = Number(req.nextUrl.searchParams.get("limit") ?? "50");
    const agent = await db.agent.findUnique({ where: { id: agentId }, select: { workspaceId: true } });
    if (!agent) return NextResponse.json({ error: "Agent not found" }, { status: 404 });
    if (agent.workspaceId) await requireAdaptiveScope({ actorUserId: user.id, workspaceId: agent.workspaceId, permission: "run.read" });
    const experiences = await listAgentExperiences(agentId, limit, agent.workspaceId ? undefined : user.id);
    return NextResponse.json(experiences);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
