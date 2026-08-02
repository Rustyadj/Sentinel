import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/current-user";
import {
  getOrCreateAgentProfile,
  listAgentCompetencies,
  listAgentKnowledgeWeights,
} from "@/lib/neural-engine/agent-profile-service";
import { listAgentExperiences } from "@/lib/neural-engine/experience-service";
import { requireLearningAgentAccess, learningAccessErrorResponse } from "@/lib/learning/authorization";

/** Agent brain view: profile + competencies + knowledge weights + recent experiences. */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ agentId: string }> },
) {
  try {
    const user = await requireUser();
    const { agentId } = await params;
    await requireLearningAgentAccess(user.id, agentId, "workspace.read");
    const [profile, competencies, weights, recentExperiences] = await Promise.all([
      getOrCreateAgentProfile(agentId),
      listAgentCompetencies(agentId),
      listAgentKnowledgeWeights(agentId, 25),
      listAgentExperiences(agentId, 10),
    ]);
    return NextResponse.json({ profile, competencies, weights, recentExperiences });
  } catch (err) {
    return learningAccessErrorResponse(err);
  }
}
