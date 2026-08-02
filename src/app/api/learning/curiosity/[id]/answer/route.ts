import { NextResponse } from "next/server";
import { requireUser } from "@/lib/current-user";
import { answerCuriosityEvent } from "@/lib/learning/curiosity";
import { requireCuriosityEventAccess, learningAccessErrorResponse } from "@/lib/learning/authorization";

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser().catch(() => null);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const body = await req.json();
  if (!body.answerSummary) {
    return NextResponse.json({ error: "answerSummary is required" }, { status: 400 });
  }
  try {
    await requireCuriosityEventAccess(user.id, id, "workspace.update");
  } catch (err) {
    return learningAccessErrorResponse(err);
  }
  const event = await answerCuriosityEvent(id, body.answerSummary, body.outcome);
  return NextResponse.json(event);
}
