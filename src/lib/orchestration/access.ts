import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { RuntimeError } from "@/lib/agents/runtime/errors";

export async function requireRoomAccess(roomId: string, userId: string) {
  const room = await db.chatRoom.findFirst({ where: { id: roomId, userId } });
  if (!room) throw new RuntimeError("Room not found", "room_not_found", 404);
  return room;
}

export function collaborationErrorResponse(error: unknown) {
  if (error instanceof Error && error.message === "Unauthorized") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (error instanceof RuntimeError) {
    return NextResponse.json({ error: error.message, code: error.code }, { status: error.status });
  }
  console.error("[collaboration api]", error);
  return NextResponse.json({ error: "Internal server error" }, { status: 500 });
}
