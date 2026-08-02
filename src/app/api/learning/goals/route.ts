import { NextResponse } from "next/server";
import { requireUser } from "@/lib/current-user";
import { generateLearningGoalsFromGaps, listLearningGoals } from "@/lib/learning/learning-goals";
import { getAccessibleLearningScope } from "@/lib/learning/authorization";

export async function GET(req: Request) {
  const user = await requireUser().catch(() => null);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const scope = await getAccessibleLearningScope(user.id);
  const goals = await listLearningGoals({
    agentId: searchParams.get("agentId") ?? undefined,
    status: searchParams.get("status") ?? undefined,
    limit: searchParams.get("limit") ? Number(searchParams.get("limit")) : undefined,
    scope,
  });
  return NextResponse.json(goals);
}

// Generates goals from currently-material knowledge gaps — not a per-goal
// create endpoint (goals are derived, not authored directly).
export async function POST(req: Request) {
  const user = await requireUser().catch(() => null);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const scope = await getAccessibleLearningScope(user.id);
  const goals = await generateLearningGoalsFromGaps({
    minPriority: body.minPriority,
    limit: body.limit,
    scope,
  });
  return NextResponse.json(goals);
}
