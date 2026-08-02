import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/current-user";
import { scanForPromotableSkills } from "@/lib/neural-engine/skill-promotion-service";
import { requireLearningAgentAccess, learningAccessErrorResponse } from "@/lib/learning/authorization";

/**
 * Scan recent Experience history for (agent, domain) groups that clear the
 * real promotion thresholds and propose `skill` LearningCandidates for them.
 * Every proposal still lands in the human review queue — this route never
 * creates a Skill directly.
 */
export async function POST(req: NextRequest) {
  try {
    const user = await requireUser();
    const body = await req.json().catch(() => ({}));
    // agentId is optional in scanForPromotableSkills (system-wide scan when
    // omitted) — require it here so this HTTP route can't be used to scan
    // every tenant's experience history at once.
    if (!body?.agentId) {
      return NextResponse.json({ error: "agentId is required" }, { status: 400 });
    }
    await requireLearningAgentAccess(user.id, body.agentId, "workspace.update");
    const result = await scanForPromotableSkills(body.agentId);
    return NextResponse.json(result);
  } catch (err) {
    return learningAccessErrorResponse(err);
  }
}
