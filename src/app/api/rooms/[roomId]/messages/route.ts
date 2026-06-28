import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/current-user";

type Params = { params: Promise<{ roomId: string }> };

export async function GET(request: NextRequest, { params }: Params) {
  try {
    const user = await requireUser();
    const { roomId } = await params;

    // Verify the room belongs to this user
    const room = await db.chatRoom.findFirst({
      where: { id: roomId, userId: user.id },
    });
    if (!room) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    const url = new URL(request.url);
    const limit = Math.min(Number(url.searchParams.get("limit") ?? "50"), 200);
    const cursor = url.searchParams.get("cursor") ?? undefined;

    const messages = await db.message.findMany({
      where: { chatRoomId: roomId },
      orderBy: { createdAt: "asc" },
      take: limit,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      select: {
        id: true,
        role: true,
        agentId: true,
        content: true,
        toolCalls: true,
        reasoning: true,
        createdAt: true,
      },
    });

    return NextResponse.json(messages);
  } catch (err) {
    if (err instanceof Error && err.message === "Unauthorized") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("[GET /api/rooms/[roomId]/messages]", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
