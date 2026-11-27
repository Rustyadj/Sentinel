import { db } from "@/lib/db";
import { findRedundantRestrictions } from "./prompt-layers";

/**
 * Autonomy metrics from real execution records in one workspace — no agent
 * self-reports. Every number is a count over persisted rows, so it can be
 * compared before/after a change over the same window.
 */
export interface AutonomyMetrics {
  windowDays: number;
  objectives: {
    total: number;
    completed: number;
    completionRate: number | null;
    approvalRequests: number;
    approvalRequestsPerObjective: number | null;
    stepsClearedByStandingAuthority: number;
    stepsWithRetries: number;
    recoveredSteps: number;
    failureRecoveryRate: number | null;
  };
  roomTasks: {
    approvalRequests: number;
    clearedByStandingAuthority: number;
    humanQuestions: number;
  };
  authority: { activeGrants: number; uses: number; revokedGrants: number };
  prompts: { compositions: number; avgSentinelChars: number | null; avgTotalChars: number | null; sentinelRestrictionFindings: number };
  /** Human touches: approvals asked for + ASK_USER questions. Lower is better at equal completion. */
  humanInterventions: number;
}

const ratio = (a: number, b: number) => (b > 0 ? Math.round((a / b) * 1000) / 1000 : null);

export async function computeAutonomyMetrics(workspaceId: string, windowDays = 30, now = new Date()): Promise<AutonomyMetrics> {
  const since = new Date(now.getTime() - windowDays * 86_400_000);
  const objectiveWhere = { workspaceId, createdAt: { gte: since } };
  const [objectives, completed, objectiveApprovals, roomApprovals, uses, stepUses, taskUses, activeGrants, revokedGrants, retried, recovered, compositions, questions] = await Promise.all([
    db.objective.count({ where: objectiveWhere }),
    db.objective.count({ where: { ...objectiveWhere, status: "completed" } }),
    db.approvalRequest.count({ where: { workspaceId, type: "objective_step", createdAt: { gte: since } } }),
    db.approvalRequest.count({ where: { workspaceId, type: "agent_execution", createdAt: { gte: since } } }),
    db.authorityGrantUse.count({ where: { workspaceId, createdAt: { gte: since } } }),
    db.authorityGrantUse.count({ where: { workspaceId, subjectType: "objective_step", createdAt: { gte: since } } }),
    db.authorityGrantUse.count({ where: { workspaceId, subjectType: { in: ["task", "guardian_review"] }, createdAt: { gte: since } } }),
    db.authorityGrant.count({ where: { workspaceId, revokedAt: null } }),
    db.authorityGrant.count({ where: { workspaceId, revokedAt: { gte: since } } }),
    db.objectiveStep.count({ where: { objective: objectiveWhere, attempts: { gt: 1 } } }),
    db.objectiveStep.count({ where: { objective: objectiveWhere, attempts: { gt: 1 }, status: "completed" } }),
    db.promptComposition.findMany({ where: { workspaceId, lastUsedAt: { gte: since } }, select: { sentinelChars: true, totalChars: true, sentinelText: true, useCount: true }, take: 500 }),
    db.message.count({ where: { messageType: "QUESTION", createdAt: { gte: since }, chatRoom: { project: { workspaceId } } } }).catch(() => 0),
  ]);
  const weighted = compositions.reduce((acc, row) => ({ n: acc.n + row.useCount, s: acc.s + row.sentinelChars * row.useCount, t: acc.t + row.totalChars * row.useCount }), { n: 0, s: 0, t: 0 });
  return {
    windowDays,
    objectives: {
      total: objectives, completed, completionRate: ratio(completed, objectives),
      approvalRequests: objectiveApprovals, approvalRequestsPerObjective: ratio(objectiveApprovals, objectives),
      stepsClearedByStandingAuthority: stepUses, stepsWithRetries: retried, recoveredSteps: recovered, failureRecoveryRate: ratio(recovered, retried),
    },
    roomTasks: { approvalRequests: roomApprovals, clearedByStandingAuthority: taskUses, humanQuestions: questions },
    authority: { activeGrants, uses, revokedGrants },
    prompts: {
      compositions: compositions.length,
      avgSentinelChars: weighted.n ? Math.round(weighted.s / weighted.n) : null,
      avgTotalChars: weighted.n ? Math.round(weighted.t / weighted.n) : null,
      sentinelRestrictionFindings: compositions.reduce((n, row) => n + findRedundantRestrictions(row.sentinelText).length, 0),
    },
    humanInterventions: objectiveApprovals + roomApprovals + questions,
  };
}
