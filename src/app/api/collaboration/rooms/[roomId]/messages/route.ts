import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/current-user";
import { collaborationErrorResponse, requireRoomAccess } from "@/lib/orchestration/access";
import { runCollaborationTurn } from "@/lib/orchestration/orchestrator";

type Context = { params: Promise<{ roomId: string }> };

export async function POST(req: NextRequest, { params }: Context) {
  try {
    const user = await requireUser();
    const { roomId } = await params;
    await requireRoomAccess(roomId, user.id);
    const body = (await req.json()) as { content?: string; recipientAgentIds?: string[] };
    if (!body.content?.trim()) {
      return NextResponse.json({ error: "content is required" }, { status: 400 });
    }

    // The lead -> implement -> review pipeline can take multiple LLM turns;
    // the caller gets an immediate 202 and follows progress through the
    // room's messages/tasks/events, which the SSE stream picks up as they
    // land (see the fire-and-forget note on runCollaborationTurn).
    void runCollaborationTurn({
      chatRoomId: roomId,
      userId: user.id,
      userContent: body.content.trim(),
      recipientAgentIds: body.recipientAgentIds,
    }).catch((error) => console.error("[collaboration] runCollaborationTurn failed", error));

    return NextResponse.json({ status: "accepted" }, { status: 202 });
  } catch (error) {
    return collaborationErrorResponse(error);
  }
}
