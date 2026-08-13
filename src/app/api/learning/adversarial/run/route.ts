import { NextResponse } from "next/server";
import { requireUser } from "@/lib/current-user";
import { runAdversarialSelfPlay } from "@/lib/learning/adversarial";
import { learningAccessErrorResponse, requireLearningWorkspaceAccess } from "@/lib/learning/authorization";

export async function POST(req: Request) {
  const user = await requireUser().catch(() => null);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  try {
    if (body.workspaceId) await requireLearningWorkspaceAccess(user.id, body.workspaceId, "workspace.update");
    const result = await runAdversarialSelfPlay({
      candidateId: body.candidateId ?? null,
      championCandidateId: body.championCandidateId ?? null,
      workspaceId: body.workspaceId ?? null,
      actorId: `user:${user.id}`,
    });
    return NextResponse.json(result);
  } catch (error) {
    return learningAccessErrorResponse(error);
  }
}
