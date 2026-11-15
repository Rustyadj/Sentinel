import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/current-user";
import { getAllVpsAgents } from "@/lib/agents/registry";
import { RUNTIME_AGENT_MAP } from "@/lib/agents/runtime/chat-routing";
import { listDiscussions } from "@/lib/roundtable/access";
import { MAX_AGENTS, MAX_ROUNDS, MIN_AGENTS, startDiscussion } from "@/lib/roundtable/engine";
import { roundtableErrorResponse } from "@/lib/roundtable/http";
import { requireProjectPermission } from "@/lib/workspaces/authorization";

export async function GET() {
  try {
    const user = await requireUser();
    const rows = await listDiscussions(user.id);
    return NextResponse.json({
      // Who can be seated. Names only: nothing here says where an agent runs.
      agents: getAllVpsAgents().filter((agent) => RUNTIME_AGENT_MAP[agent.id]).map((agent) => ({ id: agent.id, name: agent.name, kind: agent.kind })),
      limits: { minAgents: MIN_AGENTS, maxAgents: MAX_AGENTS, maxRounds: MAX_ROUNDS },
      discussions: rows.map((row) => ({
        id: row.id, title: row.title, status: row.status, agentIds: row.agentIds, rounds: row.rounds,
        createdAt: row.createdAt, completedAt: row.completedAt, projectId: row.projectId,
        projectName: row.project?.name ?? null, startedBy: row.createdBy.name ?? "Someone", mine: row.createdById === user.id, turns: row._count.turns,
      })),
    });
  } catch (error) {
    return roundtableErrorResponse(error);
  }
}

export async function POST(req: NextRequest) {
  try {
    const user = await requireUser();
    const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
    if (!body || typeof body.topic !== "string" || !Array.isArray(body.agentIds) || !body.agentIds.every((id): id is string => typeof id === "string")) {
      return NextResponse.json({ error: "topic and agentIds are required" }, { status: 400 });
    }
    const projectId = typeof body.projectId === "string" && body.projectId ? body.projectId : null;
    // Starting one inside a project makes it visible to that project's people, so it needs write access there.
    if (projectId) await requireProjectPermission(projectId, "project.update");
    const discussion = await startDiscussion({
      topic: body.topic, agentIds: body.agentIds, projectId,
      title: typeof body.title === "string" ? body.title : undefined,
      rounds: typeof body.rounds === "number" ? body.rounds : undefined,
    }, user);
    return NextResponse.json({ id: discussion.id }, { status: 201 });
  } catch (error) {
    return roundtableErrorResponse(error);
  }
}
