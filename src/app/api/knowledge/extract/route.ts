import { NextRequest, NextResponse } from "next/server";
import { extractCandidates } from "@/lib/knowledge/extraction";
import { requireUser } from "@/lib/current-user";
import { db } from "@/lib/db";
import { requireProjectPermission } from "@/lib/workspaces/authorization";

export async function POST(req: NextRequest) {
  const user = await requireUser().catch(() => null);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const body = await req.json() as {
    messages: Array<{ role: string; content: string }>;
    roomId?: string;
    projectId?: string;
  };
  if (body.roomId) {
    const room = await db.chatRoom.findFirst({ where: { id: body.roomId, userId: user.id }, select: { projectId: true } });
    if (!room) return NextResponse.json({ error: "Room not found" }, { status: 404 });
    if (body.projectId && room.projectId !== body.projectId) return NextResponse.json({ error: "Project scope mismatch" }, { status: 400 });
  }
  if (body.projectId) await requireProjectPermission(body.projectId, "project.read");
  const allowBrowserKeys = process.env.NODE_ENV !== "production" || process.env.ALLOW_BROWSER_PROVIDER_KEYS === "true";
  const anthropicKey = process.env.ANTHROPIC_API_KEY ?? (allowBrowserKeys ? req.headers.get("x-anthropic-key") ?? undefined : undefined);

  try {
    const candidates = await extractCandidates({
      messages: body.messages,
      roomId: body.roomId,
      projectId: body.projectId,
      anthropicKey,
    });
    return NextResponse.json({ candidates });
  } catch {
    return NextResponse.json({ candidates: [] });
  }
}
