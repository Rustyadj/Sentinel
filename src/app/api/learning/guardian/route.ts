import { NextResponse } from "next/server";
import { requireUser } from "@/lib/current-user";
import { listGuardianDecisions } from "@/lib/learning/guardian";

export async function GET(req: Request) {
  const user = await requireUser().catch(() => null);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const decisions = await listGuardianDecisions({
    mode: (searchParams.get("mode") as "observe" | "review" | "block" | null) ?? undefined,
    candidateId: searchParams.get("candidateId") ?? undefined,
    blockedOnly: searchParams.get("blockedOnly") === "true",
    workspaceId: searchParams.get("workspaceId") ?? undefined,
  });
  return NextResponse.json(decisions);
}
