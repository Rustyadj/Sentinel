import { NextResponse } from "next/server";
import { requireUser } from "@/lib/current-user";
import {
  detectKnowledgeGaps,
  listKnowledgeGaps,
} from "@/lib/learning/knowledge-gaps";
import { getAccessibleLearningScope } from "@/lib/learning/authorization";

export async function GET(req: Request) {
  const user = await requireUser().catch(() => null);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const scope = await getAccessibleLearningScope(user.id);
  const gaps = await listKnowledgeGaps({
    agentId: searchParams.get("agentId") ?? undefined,
    workspaceId: searchParams.get("workspaceId") ?? undefined,
    projectId: searchParams.get("projectId") ?? undefined,
    status: searchParams.get("status") ?? undefined,
    limit: searchParams.get("limit") ? Number(searchParams.get("limit")) : undefined,
    scope,
  });
  return NextResponse.json(gaps);
}

export async function POST(req: Request) {
  const user = await requireUser().catch(() => null);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const requestedWorkspaceId = typeof body.workspaceId === "string" ? body.workspaceId : undefined;
  const scope = await getAccessibleLearningScope(user.id);

  // Detection reads across curiosity/reflection rows without per-row
  // authorization — an unscoped scan would synthesize gap topics/
  // descriptions from every tenant's data. Require an explicit,
  // access-checked workspace, or default to every workspace the caller can
  // already see (never "everything").
  if (requestedWorkspaceId && !scope.workspaceIds.includes(requestedWorkspaceId)) {
    return NextResponse.json({ error: "Learning resource not found" }, { status: 404 });
  }
  if (!requestedWorkspaceId && scope.workspaceIds.length === 0) {
    return NextResponse.json({ gaps: [] });
  }

  const gaps = requestedWorkspaceId
    ? await detectKnowledgeGaps({
        agentId: typeof body.agentId === "string" ? body.agentId : undefined,
        workspaceId: requestedWorkspaceId,
        projectId: typeof body.projectId === "string" ? body.projectId : undefined,
      })
    : (
        await Promise.all(
          scope.workspaceIds.map((workspaceId) => detectKnowledgeGaps({ workspaceId })),
        )
      ).flat();
  return NextResponse.json(gaps);
}
