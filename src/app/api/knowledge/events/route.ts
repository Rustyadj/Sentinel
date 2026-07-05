import { NextRequest, NextResponse } from "next/server";
import { getRecentEvents } from "@/lib/knowledge/events";

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = req.nextUrl;
    const roomId = searchParams.get("roomId") ?? undefined;
    const projectId = searchParams.get("projectId") ?? undefined;
    const rawLimit = searchParams.get("limit");
    const limit = rawLimit ? Math.min(Math.max(1, parseInt(rawLimit, 10)), 200) : 50;

    const events = await getRecentEvents({ roomId, projectId, limit });
    return NextResponse.json({ events });
  } catch {
    return NextResponse.json({ events: [] });
  }
}
