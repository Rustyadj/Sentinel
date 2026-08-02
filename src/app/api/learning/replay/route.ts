import { NextResponse } from "next/server";
import { requireUser } from "@/lib/current-user";
import { runExperienceReplay, listReplayRuns, type ReplayCategory } from "@/lib/learning/replay";

export async function GET(req: Request) {
  const user = await requireUser().catch(() => null);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const runs = await listReplayRuns({
    category: (searchParams.get("category") as ReplayCategory) ?? undefined,
    limit: searchParams.get("limit") ? Number(searchParams.get("limit")) : undefined,
  });
  return NextResponse.json(runs);
}

export async function POST(req: Request) {
  const user = await requireUser().catch(() => null);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json();
  if (!body.category) {
    return NextResponse.json({ error: "category is required" }, { status: 400 });
  }
  const result = await runExperienceReplay(
    body.category,
    body.since ? new Date(body.since) : undefined
  );
  return NextResponse.json(result);
}
