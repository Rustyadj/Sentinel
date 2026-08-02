import { NextResponse } from "next/server";
import { requireUser } from "@/lib/current-user";
import { db } from "@/lib/db";
import { getAccessibleLearningScope } from "@/lib/learning/authorization";

// Everything genuinely waiting on a human decision, across every Learning
// Core surface — not a separate model, just a cross-cutting read over
// existing "pending" states (LearningCandidate.status=proposed,
// SkillVersion.status=draft, ApprovalRequest.status=pending linked to a
// candidate). No invented queue table.
export async function GET() {
  const user = await requireUser().catch(() => null);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const scope = await getAccessibleLearningScope(user.id);

  const [pendingCandidates, draftSkillVersions] = await Promise.all([
    db.learningCandidate.findMany({
      where: {
        status: "proposed",
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
      include: { approvalRequest: true },
      orderBy: { createdAt: "desc" },
      take: 50,
    }),
    db.skillVersion.findMany({
      where: {
        status: "draft",
        skill: { is: { workspaceId: { in: scope.workspaceIds } } },
      },
      include: { skill: { select: { name: true, domain: true } } },
      orderBy: { createdAt: "desc" },
      take: 50,
    }),
  ]);

  return NextResponse.json({ pendingCandidates, draftSkillVersions });
}
