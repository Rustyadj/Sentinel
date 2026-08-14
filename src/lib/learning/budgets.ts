// Learning budget — self-improvement resource limits.
//
// Extends LearningSettings (see its schema block) rather than a second
// config table. Organization/workspace/agent scoping and the
// agent -> workspace -> organization -> hardcoded-default resolution order
// mirror getEffectiveLearningSettings in settings.ts.

import { db } from "@/lib/db";

export interface LearningBudgetScope {
  scopeType: "organization" | "workspace" | "agent";
  scopeId: string;
}

export interface BudgetStatus {
  withinBudget: boolean;
  reasons: string[];
  usage: {
    experimentsToday: number;
    adversarialRunsToday: number;
    runningExperiments: number;
  };
  limits: {
    dailyExperimentBudget: number | null;
    maxConcurrentExperiments: number | null;
    maxCandidatesPerOpportunity: number | null;
    maxAdversarialRunsPerDay: number | null;
    maxReplaySamples: number | null;
  };
}

function startOfDayUtc(): Date {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}

/**
 * Resolves budget limits agent -> workspace -> organization, same order as
 * getEffectiveLearningSettings — the first scope with a non-null value for
 * a given field wins, independently per field.
 */
export async function resolveLearningBudget(scopes: LearningBudgetScope[]) {
  const rows = await Promise.all(
    scopes.map((scope) =>
      db.learningSettings.findUnique({
        where: { scopeType_scopeId: { scopeType: scope.scopeType, scopeId: scope.scopeId } },
      }),
    ),
  );
  const pick = <K extends "dailyExperimentBudget" | "maxConcurrentExperiments" | "maxCandidatesPerOpportunity" | "maxAdversarialRunsPerDay" | "maxReplaySamples">(
    key: K,
  ): number | null => {
    for (const row of rows) {
      if (row && row[key] != null) return row[key] as number;
    }
    return null;
  };
  return {
    dailyExperimentBudget: pick("dailyExperimentBudget"),
    maxConcurrentExperiments: pick("maxConcurrentExperiments"),
    maxCandidatesPerOpportunity: pick("maxCandidatesPerOpportunity"),
    maxAdversarialRunsPerDay: pick("maxAdversarialRunsPerDay"),
    maxReplaySamples: pick("maxReplaySamples"),
  };
}

export async function checkLearningBudget(scopes: LearningBudgetScope[]): Promise<BudgetStatus> {
  const limits = await resolveLearningBudget(scopes);
  const since = startOfDayUtc();
  const workspaceId = scopes.find((s) => s.scopeType === "workspace")?.scopeId;

  const [experimentsToday, adversarialRunsToday, runningExperiments] = await Promise.all([
    db.experimentManifest.count({ where: { startedAt: { gte: since } } }),
    db.adversarialRun.count({
      where: { createdAt: { gte: since }, ...(workspaceId ? { workspaceId } : {}) },
    }),
    db.experimentManifest.count({ where: { stage: { notIn: ["completed", "stopped"] } } }),
  ]);

  const reasons: string[] = [];
  if (limits.dailyExperimentBudget != null && experimentsToday >= limits.dailyExperimentBudget) {
    reasons.push(`daily experiment budget exceeded (${experimentsToday}/${limits.dailyExperimentBudget})`);
  }
  if (limits.maxConcurrentExperiments != null && runningExperiments >= limits.maxConcurrentExperiments) {
    reasons.push(`max concurrent experiments reached (${runningExperiments}/${limits.maxConcurrentExperiments})`);
  }
  if (limits.maxAdversarialRunsPerDay != null && adversarialRunsToday >= limits.maxAdversarialRunsPerDay) {
    reasons.push(`daily adversarial run budget exceeded (${adversarialRunsToday}/${limits.maxAdversarialRunsPerDay})`);
  }

  return {
    withinBudget: reasons.length === 0,
    reasons,
    usage: { experimentsToday, adversarialRunsToday, runningExperiments },
    limits,
  };
}
