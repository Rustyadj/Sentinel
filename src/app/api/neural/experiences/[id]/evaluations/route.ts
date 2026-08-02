import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/current-user";
import { createEvaluation, listExperienceEvaluations } from "@/lib/neural-engine/evaluation-service";
import { requireExperienceAccess, learningAccessErrorResponse } from "@/lib/learning/authorization";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const user = await requireUser();
    const { id } = await params;
    await requireExperienceAccess(user.id, id, "workspace.update");
    const body = await req.json();
    const evaluation = await createEvaluation({ ...body, experienceId: id });
    return NextResponse.json(evaluation, { status: 201 });
  } catch (err) {
    return learningAccessErrorResponse(err);
  }
}

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const user = await requireUser();
    const { id } = await params;
    await requireExperienceAccess(user.id, id, "workspace.read");
    const evaluations = await listExperienceEvaluations(id);
    return NextResponse.json(evaluations);
  } catch (err) {
    return learningAccessErrorResponse(err);
  }
}
