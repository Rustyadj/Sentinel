import { db } from "@/lib/db";
import { requireUser } from "@/lib/current-user";
import { requireLearningWorkspaceAccess, requireLearningCandidateAccess, learningAccessErrorResponse } from "@/lib/learning/authorization";
import { runExperiment } from "@/lib/learning/experiment-orchestrator";
export async function POST(request: Request) {
  const user = await requireUser().catch(() => null);
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });
  try {
    const body = await request.json();
    if (typeof body.workspaceId !== "string" || typeof body.candidateId !== "string") return Response.json({ error: "workspaceId and candidateId required" }, { status: 400 });
    await requireLearningWorkspaceAccess(user.id, body.workspaceId, "workspace.update");
    await requireLearningCandidateAccess(user.id, body.candidateId, "workspace.update");
    const candidate = await db.learningCandidate.findUniqueOrThrow({ where: { id: body.candidateId }, include: { approvalRequest: true, experience: true, knowledgeGap: true } });
    const payload = candidate.proposedPayload as Record<string, unknown>;
    const candidateWorkspace = candidate.approvalRequest?.workspaceId ?? candidate.experience?.workspaceId ?? candidate.knowledgeGap?.workspaceId ?? payload.workspaceId;
    if (candidateWorkspace !== body.workspaceId) return Response.json({ error: "Candidate and experiment must share a workspace" }, { status: 403 });
    return Response.json(await runExperiment({ candidateId: body.candidateId, workspaceId: body.workspaceId, actorId: user.id, models: body.models,
      budgetScopes: [{ scopeType: "workspace", scopeId: body.workspaceId }] }));
  } catch (error) { return learningAccessErrorResponse(error); }
}
