import { requireLearningWorkspaceAccess, LearningAccessError, learningAccessErrorResponse, requireExperienceAccess } from "@/lib/learning/authorization";
import { NextResponse } from "next/server";
import { requireUser } from "@/lib/current-user";
import { getPrincipleHistory, evolvePrinciple } from "@/lib/learning/principles";
import { db } from "@/lib/db";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser().catch(() => null);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  try {
    const principle = await db.principle.findUnique({ where: { id } });
    if (!principle?.workspaceId) throw new LearningAccessError();
    await requireLearningWorkspaceAccess(user.id, principle.workspaceId, "workspace.read");
    const history = await getPrincipleHistory(id);
    return NextResponse.json({ principle, history });
  } catch (error) { return learningAccessErrorResponse(error); }
}

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser().catch(() => null);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const body = await req.json();
  if (!body.changeReason) {
    return NextResponse.json({ error: "changeReason is required" }, { status: 400 });
  }
  try {
    const principle = await db.principle.findUnique({ where: { id } });
    if (!principle?.workspaceId) throw new LearningAccessError();
    await requireLearningWorkspaceAccess(user.id, principle.workspaceId, "workspace.update");
    for (const experienceId of [...(body.supportingExperienceIds ?? []), ...(body.contradictingExperienceIds ?? [])]) await requireExperienceAccess(user.id, experienceId, "workspace.read");
    const updated = await evolvePrinciple({ ...body, principleId: id, actorId: user.id });
    return NextResponse.json(updated);
  } catch (error) {
    return learningAccessErrorResponse(error);
  }
}
