import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireApiUser } from "@/lib/current-user";
import { requireRoomAccess } from "@/lib/orchestration/access";
import { RuntimeError } from "@/lib/agents/runtime/errors";
import { corsPreflightResponse, withMobileCors } from "@/lib/mobile-cors";

type Params = { params: Promise<{ roomId: string }> };

const MAX_NOTE_LENGTH = 8_000;

export function OPTIONS() {
  return corsPreflightResponse();
}

function failure(err: unknown, label: string): Response {
  if (err instanceof Error && err.message === "Unauthorized") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (err instanceof RuntimeError) return NextResponse.json({ error: "Not found" }, { status: 404 });
  console.error(label, err);
  return NextResponse.json({ error: "Internal server error" }, { status: 500 });
}

export async function GET(request: NextRequest, params: Params) {
  return withMobileCors(await handleGet(request, params));
}

async function handleGet(request: NextRequest, { params }: Params): Promise<Response> {
  try {
    const user = await requireApiUser(request);
    const { roomId } = await params;
    // The owner, or anyone who can read the project this room belongs to.
    await requireRoomAccess(roomId, user.id, "read");

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
        createdAt: true,
        authorUserId: true,
      },
    });

    // Names for the people who wrote in a shared room. Only names: an email
    // address is not something one project member is owed about another.
    const authorIds = [...new Set(messages.flatMap((m) => (m.authorUserId ? [m.authorUserId] : [])))];
    const authors = authorIds.length
      ? await db.user.findMany({ where: { id: { in: authorIds } }, select: { id: true, name: true } })
      : [];
    const nameById = new Map(authors.map((a) => [a.id, a.name]));

    return NextResponse.json(messages.map((m) => ({
      ...m,
      authorName: m.authorUserId ? nameById.get(m.authorUserId) ?? null : null,
      mine: m.role === "user" && (m.authorUserId === null || m.authorUserId === user.id),
    })));
  } catch (err) {
    return failure(err, "[GET /api/rooms/[roomId]/messages]");
  }
}

export async function POST(request: NextRequest, params: Params) {
  return withMobileCors(await handlePost(request, params));
}

/**
 * A message from one person to the others in the room. No agent is invoked:
 * this is how someone who cannot run agents still takes part, and how anyone
 * says something that is not a request.
 */
async function handlePost(request: NextRequest, { params }: Params): Promise<Response> {
  try {
    const user = await requireApiUser(request);
    const { roomId } = await params;
    await requireRoomAccess(roomId, user.id, "write");

    const body = (await request.json().catch(() => null)) as { content?: unknown } | null;
    const content = typeof body?.content === "string" ? body.content.trim() : "";
    if (!content) return NextResponse.json({ error: "content is required" }, { status: 400 });
    if (content.length > MAX_NOTE_LENGTH) {
      return NextResponse.json({ error: `A message can be at most ${MAX_NOTE_LENGTH} characters` }, { status: 400 });
    }

    const message = await db.message.create({
      data: { chatRoomId: roomId, role: "user", content, authorUserId: user.id },
      select: { id: true, role: true, agentId: true, content: true, createdAt: true, authorUserId: true },
    });
    return NextResponse.json({ ...message, authorName: user.name, mine: true }, { status: 201 });
  } catch (err) {
    return failure(err, "[POST /api/rooms/[roomId]/messages]");
  }
}
