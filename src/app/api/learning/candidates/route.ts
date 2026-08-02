import { NextResponse } from "next/server";
import { requireUser } from "@/lib/current-user";
import { generateCandidateFromLearningGoal } from "@/lib/learning/candidate-generation";

export async function POST(req: Request) {
  const user = await requireUser().catch(() => null);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json();
  if (!body.learningGoalId || !body.type || !body.proposedPayload || !body.testPlan) {
    return NextResponse.json(
      { error: "learningGoalId, type, proposedPayload, and testPlan are required" },
      { status: 400 }
    );
  }
  try {
    const result = await generateCandidateFromLearningGoal(body);
    return NextResponse.json(result);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to generate candidate" },
      { status: 400 }
    );
  }
}
