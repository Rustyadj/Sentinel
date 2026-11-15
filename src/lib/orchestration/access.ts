import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { RuntimeError } from "@/lib/agents/runtime/errors";
import { userCanOnProject } from "@/lib/people/project-access";

export type RoomAccessMode = "read" | "write";

/**
 * A room is reachable by the person who owns it, and by anyone who can reach
 * the project it belongs to. Reading needs project.read; writing needs
 * project.update, so a project viewer can follow a room but not post in it.
 * A room with no project is private to its owner.
 */
export async function requireRoomAccess(roomId: string, userId: string, mode: RoomAccessMode = "write") {
  const room = await db.chatRoom.findUnique({ where: { id: roomId } });
  if (!room) throw new RuntimeError("Room not found", "room_not_found", 404);
  if (room.userId === userId) return room;

  if (room.projectId) {
    const project = await db.project.findUnique({
      where: { id: room.projectId },
      select: { id: true, userId: true, workspaceId: true },
    });
    if (project && (await userCanOnProject(userId, project, mode === "read" ? "project.read" : "project.update"))) return room;
  }
  // Missing and forbidden look the same from outside.
  throw new RuntimeError("Room not found", "room_not_found", 404);
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
