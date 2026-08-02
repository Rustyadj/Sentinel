import { NextResponse } from "next/server";
import { requireUser } from "@/lib/current-user";
import { db } from "@/lib/db";

// Read-only aggregate over what's actually persisted today — Neural Engine's
// existing tables plus Phase A's LearningEvent stream. No invented numbers
// for phases (Curiosity, Reflection, Benchmarks, ...) that don't exist yet.
export async function GET() {
  const user = await requireUser().catch(() => null);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const [
    experienceTotal,
    experiencesByStatus,
    candidateTotal,
    candidatesByStatus,
    candidatesByRisk,
    competencies,
    learningEventTotal,
    recentEvents,
  ] = await Promise.all([
    db.experience.count(),
    db.experience.groupBy({ by: ["outcomeStatus"], _count: true }),
    db.learningCandidate.count(),
    db.learningCandidate.groupBy({ by: ["status"], _count: true }),
    db.learningCandidate.groupBy({ by: ["riskLevel"], _count: true }),
    db.agentCompetency.findMany({ select: { score: true } }),
    db.learningEvent.count(),
    db.learningEvent.findMany({ orderBy: { createdAt: "desc" }, take: 10 }),
  ]);

  const avgCompetency =
    competencies.length > 0
      ? competencies.reduce((sum, c) => sum + c.score, 0) / competencies.length
      : null;

  return NextResponse.json({
    experiences: {
      total: experienceTotal,
      byStatus: Object.fromEntries(experiencesByStatus.map((e) => [e.outcomeStatus, e._count])),
    },
    learningCandidates: {
      total: candidateTotal,
      byStatus: Object.fromEntries(candidatesByStatus.map((c) => [c.status, c._count])),
      byRiskLevel: Object.fromEntries(candidatesByRisk.map((c) => [c.riskLevel, c._count])),
    },
    agentCompetency: {
      avgScore: avgCompetency,
      domainsTracked: competencies.length,
    },
    learningEvents: {
      total: learningEventTotal,
      recent: recentEvents,
    },
  });
}
