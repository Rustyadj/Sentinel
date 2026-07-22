import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/current-user";
import { proposeCandidate, listPendingReview } from "@/lib/neural-engine/learning-service";
import type { RiskLevel } from "@/lib/neural-engine/types";

export async function POST(req: NextRequest) {
  try {
    await requireUser();
    const body = await req.json();
    if (!body?.type || !body?.proposedPayload) {
      return NextResponse.json(
        { error: "type and proposedPayload are required" },
        { status: 400 },
      );
    }
    const result = await proposeCandidate(body);
    return NextResponse.json(result, { status: 201 });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}

/** Human review queue — the "pending learning approvals" surface for Mission Control. */
export async function GET(req: NextRequest) {
  try {
    await requireUser();
    const riskLevel = req.nextUrl.searchParams.get("riskLevel") as RiskLevel | null;
    const candidates = await listPendingReview(riskLevel ?? undefined);
    return NextResponse.json(candidates);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
