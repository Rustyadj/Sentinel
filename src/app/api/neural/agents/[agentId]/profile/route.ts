import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/current-user";
import {
  getOrCreateAgentProfile,
  listAgentCompetencies,
  listAgentKnowledgeWeights,
} from "@/lib/neural-engine/agent-profile-service";
import { listAgentExperiences } from "@/lib/neural-engine/experience-service";

/** Agent brain view: profile + competencies + knowledge weights + recent experiences. */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ agentId: string }> },
) {
  try {
    await requireUser();
    const { agentId } = await params;
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
