import { NextResponse } from "next/server";
import { updateKnowledgeGapStatus } from "@/lib/learning-core/knowledge-gaps";

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = await req.json();
  if (!["open", "learning", "resolved"].includes(body.status)) {
    return NextResponse.json({ error: "status must be open, learning, or resolved" }, { status: 400 });
  }
  const gap = await updateKnowledgeGapStatus(id, body.status);
  return NextResponse.json(gap);
}
