import { NextRequest, NextResponse } from "next/server";
import { acceptCandidate, rejectCandidate } from "@/lib/knowledge/extraction";
import type { ExtractionCandidate } from "@/lib/knowledge/types";

export async function POST(req: NextRequest) {
  let body: { action: "accept" | "reject"; candidate: ExtractionCandidate; roomId?: string };

  try {
    body = await req.json() as { action: "accept" | "reject"; candidate: ExtractionCandidate; roomId?: string };
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid JSON" }, { status: 400 });
  }

  if (body.action === "accept") {
    try {
      const node = await acceptCandidate(body.candidate, body.roomId);
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
