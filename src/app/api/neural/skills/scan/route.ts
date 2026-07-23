import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/current-user";
import { scanForPromotableSkills } from "@/lib/neural-engine/skill-promotion-service";

/**
 * Scan recent Experience history for (agent, domain) groups that clear the
 * real promotion thresholds and propose `skill` LearningCandidates for them.
 * Every proposal still lands in the human review queue — this route never
 * creates a Skill directly.
 */
export async function POST(req: NextRequest) {
  try {
    await requireUser();
    const body = await req.json().catch(() => ({}));
    const result = await scanForPromotableSkills(body?.agentId);
    return NextResponse.json(result);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
