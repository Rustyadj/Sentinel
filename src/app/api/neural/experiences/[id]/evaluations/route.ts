import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/current-user";
import { createEvaluation, listExperienceEvaluations } from "@/lib/neural-engine/evaluation-service";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    await requireUser();
    const { id } = await params;
    const body = await req.json();
    const evaluation = await createEvaluation({ ...body, experienceId: id });
    return NextResponse.json(evaluation, { status: 201 });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    await requireUser();
    const { id } = await params;
    const evaluations = await listExperienceEvaluations(id);
    return NextResponse.json(evaluations);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
