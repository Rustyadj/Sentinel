import { NextResponse } from "next/server";
import { createHypothesis, listHypotheses } from "@/lib/learning-core/hypotheses";

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const rows = await listHypotheses({
    status: searchParams.get("status") ?? undefined,
    approvalLevel: searchParams.get("approvalLevel") ? Number(searchParams.get("approvalLevel")) : undefined,
    limit: searchParams.get("limit") ? Number(searchParams.get("limit")) : undefined,
  });
  return NextResponse.json(rows);
}

export async function POST(req: Request) {
  try {
    const body = await req.json();
    if (!body.title || !body.problem || !body.expectedImprovement || !body.rollbackPlan || !body.successCriteria) {
      return NextResponse.json({ error: "title, problem, expectedImprovement, rollbackPlan, and successCriteria are required" }, { status: 400 });
    }
    const row = await createHypothesis(body);
    return NextResponse.json(row, { status: 201 });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Unable to create hypothesis" }, { status: 400 });
  }
}
