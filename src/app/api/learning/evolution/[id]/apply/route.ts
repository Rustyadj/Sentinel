import { requireUser } from "@/lib/current-user";
import { requireLearningCandidateAccess, learningAccessErrorResponse } from "@/lib/learning/authorization";
import { applyLearningCandidate } from "@/lib/neural-engine/learning-service";
import { db } from "@/lib/db";

export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser().catch(() => null);
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });
  try {
    const { id } = await params;
    await requireLearningCandidateAccess(user.id, id, "workspace.update");
    const candidate = await db.learningCandidate.findUniqueOrThrow({ where: { id } });
    if (candidate.survivalStatus !== "champion") return Response.json({ error: "A promoted champion is required" }, { status: 409 });
    return Response.json(await applyLearningCandidate(id));
  } catch (error) { return learningAccessErrorResponse(error); }
}
