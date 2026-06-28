import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/current-user";

export async function GET() {
  try {
    const user = await requireUser();

    let rooms = await db.chatRoom.findMany({
      where: { userId: user.id },
      orderBy: { createdAt: "asc" },
      select: {
        id: true,
        name: true,
        agentIds: true,
        projectId: true,
        createdAt: true,
        _count: { select: { messages: true } },
      },
    });

    // Auto-create a default "Mission Control" room if the user has none
    if (rooms.length === 0) {
      const defaultRoom = await db.chatRoom.create({
        data: {
          name: "Mission Control",
          userId: user.id,
          agentIds: ["hermes-lisa", "claude-code"],
        },
        select: {
          id: true,
          name: true,
          agentIds: true,
          projectId: true,
          createdAt: true,
          _count: { select: { messages: true } },
        },
      });
      rooms = [defaultRoom];
    }

    return NextResponse.json(rooms);
  } catch (err) {
    if (err instanceof Error && err.message === "Unauthorized") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("[GET /api/rooms]", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const user = await requireUser();
    const body = await request.json() as { name?: string; agentIds?: string[]; projectId?: string };
    const { name, agentIds = ["hermes-lisa"], projectId } = body;

    if (!name?.trim()) {
      return NextResponse.json({ error: "name is required" }, { status: 400 });
    }

    const room = await db.chatRoom.create({
      data: {
        name: name.trim(),
        userId: user.id,
        agentIds,
        ...(projectId ? { projectId } : {}),
      },
      select: {
        id: true,
        name: true,
        agentIds: true,
        projectId: true,
        createdAt: true,
        _count: { select: { messages: true } },
      },
    });

    return NextResponse.json(room, { status: 201 });
  } catch (err) {
    if (err instanceof Error && err.message === "Unauthorized") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("[POST /api/rooms]", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
