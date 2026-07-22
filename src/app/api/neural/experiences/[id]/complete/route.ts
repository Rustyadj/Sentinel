import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/current-user";
import { completeExperience } from "@/lib/neural-engine/experience-service";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    await requireUser();
    const { id } = await params;
    const body = await req.json();
    if (!body?.outcome?.status) {
      return NextResponse.json(
        { error: "outcome.status is required" },
        { status: 400 },
      );
    }
    const experience = await completeExperience({
      experienceId: id,
      outcome: body.outcome,
      cost: body.cost,
      latencyMs: body.latencyMs,
      outputArtifactIds: body.outputArtifactIds,
    });
    return NextResponse.json(experience);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
