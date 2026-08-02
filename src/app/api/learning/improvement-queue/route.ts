import { NextResponse } from "next/server";
import { requireUser } from "@/lib/current-user";
import { db } from "@/lib/db";

// Everything genuinely waiting on a human decision, across every Learning
// Core surface — not a separate model, just a cross-cutting read over
// existing "pending" states (LearningCandidate.status=proposed,
// SkillVersion.status=draft, ApprovalRequest.status=pending linked to a
// candidate). No invented queue table.
export async function GET() {
  const user = await requireUser().catch(() => null);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const [pendingCandidates, draftSkillVersions] = await Promise.all([
    db.learningCandidate.findMany({
      where: { status: "proposed" },
      include: { approvalRequest: true },
      orderBy: { createdAt: "desc" },
      take: 50,
    }),
    db.skillVersion.findMany({
      where: { status: "draft" },
      include: { skill: { select: { name: true, domain: true } } },
      orderBy: { createdAt: "desc" },
      take: 50,
    }),
  ]);

  return NextResponse.json({ pendingCandidates, draftSkillVersions });
}
