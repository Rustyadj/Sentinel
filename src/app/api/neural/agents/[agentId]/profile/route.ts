import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/current-user";
import {
  getOrCreateAgentProfile,
  listAgentCompetencies,
  listAgentKnowledgeWeights,
} from "@/lib/neural-engine/agent-profile-service";
import { listAgentExperiences } from "@/lib/neural-engine/experience-service";
import { db } from "@/lib/db";
import { requireAdaptiveScope } from "@/lib/adaptive-memory/scope";

/** Agent brain view: profile + competencies + knowledge weights + recent experiences. */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ agentId: string }> },
) {
  try {
    const user = await requireUser();
    const { agentId } = await params;
    const agent = await db.agent.findUnique({ where: { id: agentId }, select: { workspaceId: true } });
    if (!agent?.workspaceId) return NextResponse.json({ error: "Agent profile unavailable without workspace scope." }, { status: 404 });
    await requireAdaptiveScope({ actorUserId: user.id, workspaceId: agent.workspaceId, permission: "agent.read" });
    const [profile, competencies, weights, recentExperiences] = await Promise.all([
      getOrCreateAgentProfile(agentId),
      listAgentCompetencies(agentId),
      listAgentKnowledgeWeights(agentId, 25),
      listAgentExperiences(agentId, 10),
    ]);
    return NextResponse.json({ profile, competencies, weights, recentExperiences });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
