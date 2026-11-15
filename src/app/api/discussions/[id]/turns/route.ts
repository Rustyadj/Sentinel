import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/current-user";
import { requireDiscussionAccess } from "@/lib/roundtable/access";
import { interject } from "@/lib/roundtable/engine";
import { roundtableErrorResponse } from "@/lib/roundtable/http";

/** A person speaks in the roundtable. No agent is run by this; they answer on their next turn. */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireUser();
    const { id } = await params;
    await requireDiscussionAccess(id, user.id, "write");
    const body = (await req.json().catch(() => null)) as { content?: unknown } | null;
    if (typeof body?.content !== "string") return NextResponse.json({ error: "content is required" }, { status: 400 });
    const turn = await interject(id, user.id, body.content);
    return NextResponse.json({ id: turn.id, sequence: turn.sequence }, { status: 201 });
  } catch (error) {
    return roundtableErrorResponse(error);
  }
}
