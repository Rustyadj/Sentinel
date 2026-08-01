import { NextResponse } from "next/server";
import { listReplayEntries } from "@/lib/learning-core/replay";

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const entries = await listReplayEntries({
    category: searchParams.get("category") ?? undefined,
    limit: searchParams.get("limit") ? Number(searchParams.get("limit")) : undefined,
  });
  return NextResponse.json(entries);
}
