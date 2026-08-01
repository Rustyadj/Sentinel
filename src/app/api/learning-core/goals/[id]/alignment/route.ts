import { NextResponse } from "next/server";
import { checkGoalAlignment, listGoalAlignmentChecks } from "@/lib/learning-core/goals";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const checks = await listGoalAlignmentChecks({ goalId: id });
  return NextResponse.json(checks);
}

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = await req.json();
  if (!body.actionRef) {
    return NextResponse.json({ error: "actionRef is required" }, { status: 400 });
  }
  const check = await checkGoalAlignment({ goalId: id, actionRef: body.actionRef });
  return NextResponse.json(check);
}
