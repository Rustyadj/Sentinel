import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/current-user";
import { recordTimeToFirstAudio } from "@/lib/system-one/telemetry";

export const runtime = "nodejs";

/**
 * Time-to-first-audio is only observable in the browser, after the live layer
 * starts speaking. The client reports it here against the decision row the
 * reasoning call returned; the update is owner-checked and write-once.
 */
export async function POST(req: NextRequest) {
  const user = await requireUser().catch(() => null);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const body = (await req.json().catch(() => null)) as { decisionId?: unknown; ttfaMs?: unknown } | null;
  if (typeof body?.decisionId !== "string" || typeof body.ttfaMs !== "number") {
    return NextResponse.json({ error: "decisionId and ttfaMs are required" }, { status: 400 });
  }
  const recorded = await recordTimeToFirstAudio(body.decisionId, user.id, body.ttfaMs).catch(() => false);
  return NextResponse.json({ recorded });
}
