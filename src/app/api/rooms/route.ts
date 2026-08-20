import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireApiUser } from "@/lib/current-user";
import { requireProjectPermission } from "@/lib/workspaces/authorization";
import { corsPreflightResponse, withMobileCors } from "@/lib/mobile-cors";

export function OPTIONS() {
  return corsPreflightResponse();
}

export async function GET(request: NextRequest) {
  return withMobileCors(await handleGet(request));
}

async function handleGet(request: NextRequest): Promise<Response> {
  try {
    const user = await requireApiUser(request);

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
          agentIds: ["hermes-lisa", "claude-code", "codex"],
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
  return withMobileCors(await handlePost(request));
}

async function handlePost(request: NextRequest): Promise<Response> {
  try {
    const user = await requireApiUser(request);
    const body = await request.json() as { name?: string; agentIds?: string[]; projectId?: string };
    const { name, agentIds = ["hermes-lisa"], projectId } = body;

    if (!name?.trim()) {
      return NextResponse.json({ error: "name is required" }, { status: 400 });
    }
    if (projectId) await requireProjectPermission(projectId, "project.read");

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
