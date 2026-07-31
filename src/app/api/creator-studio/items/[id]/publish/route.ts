import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/current-user";
import { requireOwnedItem } from "@/lib/creator-studio/access";
import { db } from "@/lib/db";

/**
 * Stub publish action — no real platform integrations (YouTube/TikTok/Meta/
 * LinkedIn/WordPress/etc.) are wired up yet, per the Phase 1 scope decision.
 * This records the status transition so the Publishing Center workflow is
 * real, but always "succeeds" rather than pretending to call a platform API
 * that doesn't exist. `stub: true` in the response is intentional, not a bug —
 * the UI surfaces it so nobody mistakes this for a live publish.
 */
export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  const { id } = await params;
  if (!(await requireOwnedItem(id, user.id))) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const item = await db.contentItem.update({
    where: { id },
    data: { status: "published", publishedAt: new Date() },
  });
  return NextResponse.json({ item, stub: true });
}
