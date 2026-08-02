import { NextResponse } from "next/server";
import { requireUser } from "@/lib/current-user";
import { getAccessibleWorkspaceIds } from "@/lib/agents/permissions";
import { db } from "@/lib/db";

// Read-only aggregate over what's actually persisted today — Neural Engine's
// existing tables plus Phase A's LearningEvent stream. No invented numbers
// for phases (Curiosity, Reflection, Benchmarks, ...) that don't exist yet.
//
// Scoped to the caller's accessible workspaces/projects — same pattern as
// buildMissionControlData (src/lib/mission-control/server.ts). Experience
// and LearningCandidate only carry workspaceId/projectId transitively
// through relations, so those queries scope through that relation;
// LearningEvent carries workspaceId directly.
export async function GET() {
  const user = await requireUser().catch(() => null);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const workspaceIds = await getAccessibleWorkspaceIds(user.id);
  const accessibleProjects = await db.project.findMany({
    where: { OR: [{ userId: user.id }, { workspaceId: { in: workspaceIds } }] },
    select: { id: true },
  });
  const accessibleProjectIds = accessibleProjects.map((project) => project.id);
  const experienceScope = { OR: [{ workspaceId: { in: workspaceIds } }, { projectId: { in: accessibleProjectIds } }] };
  const candidateScope = { experience: { is: experienceScope } };
  const eventScope = { OR: [{ userId: user.id }, { workspaceId: { in: workspaceIds } }] };
  // AgentCompetency.agentId is a plain String with no FK relation (matches
  // the rest of Neural Engine's convention — see docs/LEARNING_CORE_ON_NEURAL_ENGINE.md),
  // so scoping goes through a separate accessible-agent-ids lookup rather
  // than a relation filter.
  const accessibleAgents = await db.agent.findMany({ where: { workspaceId: { in: workspaceIds } }, select: { id: true } });
  const accessibleAgentIds = accessibleAgents.map((agent) => agent.id);

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
    db.experience.count({ where: experienceScope }),
    db.experience.groupBy({ by: ["outcomeStatus"], where: experienceScope, _count: true }),
    db.learningCandidate.count({ where: candidateScope }),
    db.learningCandidate.groupBy({ by: ["status"], where: candidateScope, _count: true }),
    db.learningCandidate.groupBy({ by: ["riskLevel"], where: candidateScope, _count: true }),
    db.agentCompetency.findMany({ where: { agentId: { in: accessibleAgentIds } }, select: { score: true } }),
    db.learningEvent.count({ where: eventScope }),
    db.learningEvent.findMany({
      where: eventScope,
      orderBy: { createdAt: "desc" },
      take: 10,
      select: { id: true, eventType: true, sourceType: true, severity: true, agentId: true, workspaceId: true, projectId: true, createdAt: true },
    }),
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
