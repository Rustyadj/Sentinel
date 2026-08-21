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

    const roomSelect = {
      id: true,
      name: true,
      agentIds: true,
      projectId: true,
      createdAt: true,
      isPrimary: true,
      mode: true,
      _count: { select: { messages: true } },
    } as const;

    let rooms = await db.chatRoom.findMany({
      where: { userId: user.id },
      orderBy: { createdAt: "asc" },
      select: roomSelect,
    });

    // Auto-create a default "Mission Control" room if the user has none.
    // This is always the primary room: the one that normal Mission Control
    // usage resolves to and that always resets to collaborative/Lisa below,
    // as opposed to an ad-hoc direct-worker room created via POST.
    if (rooms.length === 0) {
      const defaultRoom = await db.chatRoom.create({
        data: {
          name: "Mission Control",
          userId: user.id,
          agentIds: ["hermes-lisa", "claude-code", "codex"],
          isPrimary: true,
        },
        select: roomSelect,
      });
      rooms = [defaultRoom];
    }

    // Every account has exactly one primary room. Pre-existing accounts from
    // before isPrimary existed get backfilled by the migration, but guard
    // here too in case that ever comes up empty (e.g. every room got deleted
    // and recreated by hand) — promote the oldest room rather than leaving
    // no primary room at all.
    let primary = rooms.find((room) => room.isPrimary);
    if (!primary) {
      primary = rooms[0];
      const promoted = await db.chatRoom.update({ where: { id: primary.id }, data: { isPrimary: true }, select: roomSelect });
      rooms = rooms.map((room) => (room.id === promoted.id ? promoted : room));
      primary = promoted;
    }

    // The primary room always presents as collaborative/Lisa-led when
    // resolved this way, regardless of what it was last switched to mid
    // session (e.g. "Take Control" or a solo/@mention override) — that
    // transient state doesn't survive a fresh resolution of Mission
    // Control. An explicitly-created direct-worker room (isPrimary=false)
    // is unaffected and may keep its own mode.
    if (primary.mode !== "collaborative") {
      const reset = await db.chatRoom.update({ where: { id: primary.id }, data: { mode: "collaborative" }, select: roomSelect });
      rooms = rooms.map((room) => (room.id === reset.id ? reset : room));
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
