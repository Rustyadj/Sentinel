import { NextResponse } from "next/server";
import { requireUser } from "@/lib/current-user";
import { getQueueStatus } from "@/lib/learning/queue";
import { db } from "@/lib/db";

export async function GET() {
  const user = await requireUser().catch(() => null);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const [queueStatus, recentRuns] = await Promise.all([
    getQueueStatus(),
    db.scheduledJobRun.findMany({ orderBy: { startedAt: "desc" }, take: 20 }),
  ]);

  return NextResponse.json({ queue: queueStatus, recentRuns });
}
