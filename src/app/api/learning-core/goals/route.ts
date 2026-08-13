import { NextResponse } from "next/server";
import { recordGoal } from "@/lib/learning-core/goals";

export async function POST(req: Request) {
  const body = await req.json();
  if (!body.requestedGoal) {
    return NextResponse.json({ error: "requestedGoal is required" }, { status: 400 });
  }
  const goal = await recordGoal(body);
  return NextResponse.json(goal);
}
