import { getAccessibleLearningScope } from "@/lib/learning/authorization";
import { NextResponse } from "next/server";
import { requireUser } from "@/lib/current-user";
import { listPrinciples, distillPrinciple } from "@/lib/learning/principles";
import { LearningAccessError, requireExperienceAccess, requireLearningAgentAccess, learningAccessErrorResponse, requireLearningWorkspaceAccess } from "@/lib/learning/authorization";

export async function GET(req: Request) {
  const user = await requireUser().catch(() => null);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const accessibleWorkspaceIds = (await getAccessibleLearningScope(user.id)).workspaceIds;
  const { searchParams } = new URL(req.url);
  const principles = await listPrinciples({ accessibleWorkspaceIds,
    domain: searchParams.get("domain") ?? undefined,
    workspaceId: searchParams.get("workspaceId") ?? undefined,
    agentId: searchParams.get("agentId") ?? undefined,
    status: searchParams.get("status") ?? undefined,
  });
  return NextResponse.json(principles);
}

export async function POST(req: Request) {
  const user = await requireUser().catch(() => null);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json();
  if (!body.statement || !body.scope || !body.supportingExperienceIds || body.evidenceConfidence === undefined) {
    return NextResponse.json(
      { error: "statement, scope, supportingExperienceIds, and evidenceConfidence are required" },
      { status: 400 },
    );
  }
  try {
    if (!body.workspaceId || body.scope === "global") throw new LearningAccessError();
    await requireLearningWorkspaceAccess(user.id, body.workspaceId, "workspace.update");
    if (body.agentId) await requireLearningAgentAccess(user.id, body.agentId, "workspace.update");
    for (const experienceId of [...body.supportingExperienceIds, ...(body.contradictingExperienceIds ?? [])]) await requireExperienceAccess(user.id, experienceId, "workspace.read");
    const result = await distillPrinciple(body);
    return NextResponse.json(result);
  } catch (error) {
    return learningAccessErrorResponse(error);
  }
}
