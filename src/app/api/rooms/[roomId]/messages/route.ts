import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireApiUser } from "@/lib/current-user";
import { requireRoomAccess } from "@/lib/orchestration/access";
import { RuntimeError } from "@/lib/agents/runtime/errors";
import { corsPreflightResponse, withMobileCors } from "@/lib/mobile-cors";
import { findConnectedOutsideAgent, outsideAgentNames } from "@/lib/collaboration/project-agents";
import { runOutsideAgentReply } from "@/lib/orchestration/outside-agent-turn";

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
    const room = await requireRoomAccess(roomId, user.id, "read");

    const url = new URL(request.url);
    const limit = Math.min(Number(url.searchParams.get("limit") ?? "50"), 200);
    const cursor = url.searchParams.get("cursor") ?? undefined;

    const messages = await db.message.findMany({
      where: { chatRoomId: roomId },
      orderBy: { createdAt: cursor ? "asc" : "desc" },
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

    if (!cursor) messages.reverse();

    // Names for the people who wrote in a shared room. Only names: an email
    // address is not something one project member is owed about another.
    const authorIds = [...new Set(messages.flatMap((m) => (m.authorUserId ? [m.authorUserId] : [])))];
    const authors = authorIds.length
      ? await db.user.findMany({ where: { id: { in: authorIds } }, select: { id: true, name: true } })
      : [];
    const nameById = new Map(authors.map((a) => [a.id, a.name]));
    // Agents people brought are not in the client's registry, so their names travel with the transcript.
    const outsideNames = await outsideAgentNames(room.projectId, messages.map((m) => m.agentId));

    return NextResponse.json(messages.map((m) => ({
      ...m,
      ...(m.agentId && outsideNames.has(m.agentId) ? { agentName: outsideNames.get(m.agentId) } : {}),
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
 * A message from one person to the others in the room. No Sentinel agent is
 * invoked: this is how someone who cannot run agents still takes part, and
 * how anyone says something that is not a request.
 *
 * With `toAgentId` naming an agent someone brought to this room's project,
 * that agent is also sent the message, on its owner's own server. Its answer
 * arrives in the room afterwards; this request does not wait for it.
 */
async function handlePost(request: NextRequest, { params }: Params): Promise<Response> {
  try {
    const user = await requireApiUser(request);
    const { roomId } = await params;
    const room = await requireRoomAccess(roomId, user.id, "write");

    const body = (await request.json().catch(() => null)) as { content?: unknown; toAgentId?: unknown } | null;
    const content = typeof body?.content === "string" ? body.content.trim() : "";
    if (!content) return NextResponse.json({ error: "content is required" }, { status: 400 });
    if (content.length > MAX_NOTE_LENGTH) {
      return NextResponse.json({ error: `A message can be at most ${MAX_NOTE_LENGTH} characters` }, { status: 400 });
    }

    const toAgentId = typeof body?.toAgentId === "string" && body.toAgentId ? body.toAgentId : null;
    if (toAgentId && !(room.projectId && (await findConnectedOutsideAgent(room.projectId, toAgentId)))) {
      return NextResponse.json({ error: "That agent is not connected to this project." }, { status: 404 });
    }

    // A paused room takes no new work for any agent, whoever runs it. Refused
    // rather than quietly recorded, so the person knows it was not asked.
    if (toAgentId && room.paused) {
      return NextResponse.json({ error: "This room is paused, so agents are not being asked. Tell the room instead, or resume it." }, { status: 409 });
    }

    const message = await db.message.create({
      data: { chatRoomId: roomId, role: "user", content, authorUserId: user.id },
      select: { id: true, role: true, agentId: true, content: true, createdAt: true, authorUserId: true },
    });
    if (toAgentId) {
      void runOutsideAgentReply({ roomId, projectId: room.projectId, agentId: toAgentId, userId: user.id, userContent: content })
        .catch((error) => console.error("[rooms] outside agent reply failed", error));
    }
    return NextResponse.json({ ...message, authorName: user.name, mine: true }, { status: 201 });
  } catch (err) {
    return failure(err, "[POST /api/rooms/[roomId]/messages]");
  }
}
