import { NextResponse } from "next/server";
import { requireUser } from "@/lib/current-user";
import { db } from "@/lib/db";

// Every phase's real activity already emits a LearningEvent (curiosity,
// reflection, candidate proposal/review/apply/rollback, benchmark runs,
// feature-flag changes, trust deltas) — the timeline is a direct read over
// that existing stream, not a second event log built for this view.
export async function GET(req: Request) {
  const user = await requireUser().catch(() => null);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const limit = Math.min(Number(searchParams.get("limit") ?? 100), 500);

  const events = await db.learningEvent.findMany({
    orderBy: { createdAt: "desc" },
    take: limit,
  });

  return NextResponse.json(events);
}
