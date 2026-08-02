import { NextResponse } from "next/server";
import { requireUser } from "@/lib/current-user";
import { runExperienceReplay, listReplayRuns, type ReplayCategory } from "@/lib/learning/replay";
import { getAccessibleLearningScope } from "@/lib/learning/authorization";

export async function GET(req: Request) {
  const user = await requireUser().catch(() => null);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const scope = await getAccessibleLearningScope(user.id);
  const runs = await listReplayRuns({
    category: (searchParams.get("category") as ReplayCategory) ?? undefined,
    limit: searchParams.get("limit") ? Number(searchParams.get("limit")) : undefined,
    scope,
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
  // selectExperiencesForCategory() runs system-wide by design (this backs
  // the scheduled worker job, which legitimately analyzes patterns across
  // every tenant). The HTTP route exposes it as an ad-hoc trigger to any
  // authenticated user, so the response here is deliberately metadata-only
  // — lessons/improvementOpportunities text (which can synthesize other
  // tenants' content) is only visible through the now-scoped GET, once the
  // resulting run overlaps the caller's own accessible experiences.
  const result = await runExperienceReplay(
    body.category,
    body.since ? new Date(body.since) : undefined
  );
  return NextResponse.json({
    category: result.category,
    implemented: result.implemented,
    experienceCount: result.experienceCount,
    runId: result.run?.id ?? null,
  });
}
