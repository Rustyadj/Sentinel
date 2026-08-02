import { NextResponse } from "next/server";
import { requireUser } from "@/lib/current-user";
import { updateLearningGoal } from "@/lib/learning/learning-goals";
import { listCandidatesForGoal } from "@/lib/learning/candidate-generation";
import { requireLearningGoalAccess, learningAccessErrorResponse } from "@/lib/learning/authorization";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser().catch(() => null);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  try {
    await requireLearningGoalAccess(user.id, id, "workspace.read");
  } catch (err) {
    return learningAccessErrorResponse(err);
  }
  const candidates = await listCandidatesForGoal(id);
  return NextResponse.json({ candidates });
}

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser().catch(() => null);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  try {
    await requireLearningGoalAccess(user.id, id, "workspace.update");
  } catch (err) {
    return learningAccessErrorResponse(err);
  }
  const body = await req.json();
  const goal = await updateLearningGoal(id, { status: body.status, approved: body.approved });
  return NextResponse.json(goal);
}
