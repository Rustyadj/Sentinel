import { NextRequest, NextResponse } from "next/server";
import { getRecentEvents } from "@/lib/knowledge/events";
import { requireUser } from "@/lib/current-user";
import { db } from "@/lib/db";
import { requireProjectPermission } from "@/lib/workspaces/authorization";

export async function GET(req: NextRequest) {
  try {
    const user = await requireUser();
    const { searchParams } = req.nextUrl;
    const roomId = searchParams.get("roomId") ?? undefined;
    const projectId = searchParams.get("projectId") ?? undefined;
    const rawLimit = searchParams.get("limit");
    const parsed = rawLimit ? Number.parseInt(rawLimit, 10) : 50;
    const limit = Number.isFinite(parsed) ? Math.min(Math.max(1, parsed), 200) : 50;

    if (roomId) {
      const room = await db.chatRoom.findFirst({ where: { id: roomId, userId: user.id }, select: { id: true } });
      if (!room) return NextResponse.json({ error: "Room not found" }, { status: 404 });
    }
    if (projectId) await requireProjectPermission(projectId, "project.read");

    const events = await getRecentEvents({ userId: user.id, roomId, projectId, limit });
    return NextResponse.json({ events });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Event query failed";
    return NextResponse.json({ error: message, events: [] }, { status: message === "Unauthorized" ? 401 : 500 });
  }
}
