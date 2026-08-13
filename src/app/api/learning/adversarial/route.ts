import { NextResponse } from "next/server";
import { requireUser } from "@/lib/current-user";
import { listAdversarialRuns } from "@/lib/learning/adversarial";

export async function GET(req: Request) {
  const user = await requireUser().catch(() => null);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const runs = await listAdversarialRuns({
    candidateId: searchParams.get("candidateId") ?? undefined,
    outcome: searchParams.get("outcome") ?? undefined,
  });
  return NextResponse.json(runs);
}
