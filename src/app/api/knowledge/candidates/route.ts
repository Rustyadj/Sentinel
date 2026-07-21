import { NextRequest, NextResponse } from "next/server";
import { acceptCandidate, rejectCandidate } from "@/lib/knowledge/extraction";
import type { ExtractionCandidate } from "@/lib/knowledge/types";
import { requireUser } from "@/lib/current-user";
import { db } from "@/lib/db";

export async function POST(req: NextRequest) {
  let body: { action: "accept" | "reject"; candidate: ExtractionCandidate; roomId?: string };

  try {
    body = await req.json() as { action: "accept" | "reject"; candidate: ExtractionCandidate; roomId?: string };
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid JSON" }, { status: 400 });
  }

  if (body.action === "accept") {
    try {
      const user = await requireUser();
      const room = body.roomId
        ? await db.chatRoom.findFirst({
            where: { id: body.roomId, userId: user.id },
            select: { projectId: true },
          })
        : null;
      if (body.roomId && !room) {
        return NextResponse.json({ ok: false, error: "Room not found" }, { status: 404 });
      }
      const node = await acceptCandidate(
        body.candidate,
        user.id,
        body.roomId,
        room?.projectId ?? undefined
      );
      return NextResponse.json({ ok: true, node });
    } catch (err) {
      return NextResponse.json(
        { ok: false, error: err instanceof Error ? err.message : String(err) },
        { status: 500 }
      );
    }
  }

  if (body.action === "reject") {
    try {
      await requireUser();
      await rejectCandidate(body.candidate);
      return NextResponse.json({ ok: true });
    } catch (err) {
      // Non-fatal — rejection failure shouldn't break UX
      console.error("rejectCandidate error:", err);
      return NextResponse.json({ ok: false });
    }
  }

  return NextResponse.json({ error: "Invalid action" }, { status: 400 });
}
