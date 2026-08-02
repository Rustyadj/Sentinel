import { NextResponse } from "next/server";
import { requireUser } from "@/lib/current-user";
import { db } from "@/lib/db";
import { generateCandidateFromLearningGoal } from "@/lib/learning/candidate-generation";
import {
  getAccessibleLearningScope,
  requireLearningGoalAccess,
  learningAccessErrorResponse,
} from "@/lib/learning/authorization";

export async function GET(req: Request) {
  const user = await requireUser().catch(() => null);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const status = searchParams.get("status") ?? undefined;
  const scope = await getAccessibleLearningScope(user.id);
  // LearningCandidate has no direct workspace/project/agent column — its
  // ownership is transitive through whichever relation is populated (mirrors
  // requireLearningCandidateAccess's resolution order for a single
  // resource). A candidate with none of these relations set is excluded
  // rather than shown globally.
  const candidates = await db.learningCandidate.findMany({
    where: {
      ...(status ? { status } : {}),
      OR: [
        { approvalRequest: { is: { workspaceId: { in: scope.workspaceIds } } } },
        {
          experience: {
            is: {
              OR: [
                { workspaceId: { in: scope.workspaceIds } },
                { projectId: { in: scope.projectIds } },
                { agentId: { in: scope.agentIds } },
              ],
            },
          },
        },
        {
          knowledgeGap: {
            is: {
              OR: [
                { workspaceId: { in: scope.workspaceIds } },
                { projectId: { in: scope.projectIds } },
                { agentId: { in: scope.agentIds } },
              ],
            },
          },
        },
      ],
    },
    orderBy: { createdAt: "desc" },
    take: Math.min(Number(searchParams.get("limit") ?? 50), 200),
  });
  return NextResponse.json(candidates);
}

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
    await requireLearningGoalAccess(user.id, body.learningGoalId, "workspace.update");
  } catch (err) {
    return learningAccessErrorResponse(err);
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
