import { NextResponse } from "next/server";
import { requireUser } from "@/lib/current-user";
import { promoteChallenger } from "@/lib/learning/evolution";
import { learningAccessErrorResponse, requireLearningCandidateAccess } from "@/lib/learning/authorization";

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser().catch(() => null);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const body = await req.json().catch(() => ({}));
  try {
    await requireLearningCandidateAccess(user.id, id, "workspace.update");
    const decision = await promoteChallenger(id, {
      actorId: user.id,
      reason: body.reason,
      workspaceId: body.workspaceId,
      guardrails: body.guardrails,
    });
    return NextResponse.json(decision);
  } catch (error) {
    return learningAccessErrorResponse(error);
  }
}
