import { NextResponse } from "next/server";
import { requireUser } from "@/lib/current-user";
import { runShadowSample, listShadowRuns, evaluateShadowPromotion } from "@/lib/learning/shadow";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser().catch(() => null);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const [runs, promotion] = await Promise.all([listShadowRuns(id), evaluateShadowPromotion(id)]);
  return NextResponse.json({ runs, promotion });
}

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser().catch(() => null);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const body = await req.json();
  if (!body.sourceExperienceId) {
    return NextResponse.json({ error: "sourceExperienceId is required" }, { status: 400 });
  }
  try {
    const result = await runShadowSample({ candidateId: id, sourceExperienceId: body.sourceExperienceId });
    return NextResponse.json(result);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to run shadow sample" },
      { status: 400 }
    );
  }
}
