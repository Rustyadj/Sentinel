import { db } from "@/lib/db";
import { removeFeatureFlagFromGraph, syncFeatureFlagToGraph } from "./graph";
import { updateExperiment } from "./experiments";
import { updateHypothesis } from "./hypotheses";
import { updateSkill } from "./skills";

export const FEATURE_FLAG_SCOPES = ["global", "agent", "workspace", "user", "organization"] as const;

export async function createFeatureFlag(input: {
  key: string;
  enabled?: boolean;
  scope?: string;
  scopeId?: string;
  rolloutPercentage?: number;
  autoRollbackThreshold?: number;
}) {
  const scope = input.scope ?? "global";
  if (!FEATURE_FLAG_SCOPES.includes(scope as (typeof FEATURE_FLAG_SCOPES)[number])) throw new Error("Invalid scope");
  if (scope !== "global" && !input.scopeId) throw new Error("scopeId is required for non-global flags");
  const rolloutPercentage = input.rolloutPercentage ?? 0;
  if (rolloutPercentage < 0 || rolloutPercentage > 100) throw new Error("rolloutPercentage must be between 0 and 100");
  const flag = await db.featureFlag.create({
    data: {
      key: input.key,
      enabled: input.enabled ?? false,
      scope,
      scopeId: scope === "global" ? null : input.scopeId,
      rolloutPercentage,
      autoRollbackThreshold: input.autoRollbackThreshold ?? null,
    },
  });
  await syncFeatureFlagToGraph(flag);
  return flag;
}

export async function updateFeatureFlag(
  id: string,
  input: Partial<{
    key: string;
    enabled: boolean;
    scope: string;
    scopeId: string | null;
    rolloutPercentage: number;
    autoRollbackThreshold: number | null;
  }>,
) {
  const existing = await db.featureFlag.findUniqueOrThrow({ where: { id } });
  const scope = input.scope ?? existing.scope;
  const scopeId = input.scopeId === undefined ? existing.scopeId : input.scopeId;
  if (!FEATURE_FLAG_SCOPES.includes(scope as (typeof FEATURE_FLAG_SCOPES)[number])) throw new Error("Invalid scope");
  if (scope !== "global" && !scopeId) throw new Error("scopeId is required for non-global flags");
  if (input.rolloutPercentage !== undefined && (input.rolloutPercentage < 0 || input.rolloutPercentage > 100)) {
    throw new Error("rolloutPercentage must be between 0 and 100");
  }
  const flag = await db.featureFlag.update({
    where: { id },
    data: { ...input, scopeId: scope === "global" ? null : scopeId },
  });
  await syncFeatureFlagToGraph(flag);
  return flag;
}

export async function listFeatureFlags(params?: { scope?: string; enabled?: boolean }) {
  return db.featureFlag.findMany({
    where: {
      ...(params?.scope ? { scope: params.scope } : {}),
      ...(params?.enabled === undefined ? {} : { enabled: params.enabled }),
    },
    orderBy: { updatedAt: "desc" },
  });
}

export async function getFeatureFlag(id: string) {
  return db.featureFlag.findUnique({ where: { id } });
}

export async function deleteFeatureFlag(id: string) {
  const flag = await db.featureFlag.delete({ where: { id } });
  await removeFeatureFlagFromGraph(id);
  return flag;
}

export async function listImprovementQueue() {
  const [hypotheses, experiments, skills] = await Promise.all([
    db.hypothesis.findMany({
      where: {
        status: "testing",
        approvalLevel: { gte: 2 },
        experiments: { none: { status: { in: ["promoted", "discarded"] } } },
      },
      orderBy: [{ approvalLevel: "desc" }, { updatedAt: "asc" }],
    }),
    db.experiment.findMany({
      where: { status: "completed", approvalLevel: { gte: 2 } },
      include: { hypothesis: { select: { id: true, title: true } } },
      orderBy: [{ approvalLevel: "desc" }, { startedAt: "asc" }],
    }),
    db.skill.findMany({
      where: { status: "testing", approvalLevel: { gte: 2 } },
      orderBy: [{ approvalLevel: "desc" }, { updatedAt: "asc" }],
    }),
  ]);
  return { hypotheses, experiments, skills };
}

export async function decideImprovement(input: {
  type: "hypothesis" | "experiment" | "skill";
  id: string;
  decision: "approve" | "reject";
  humanUserId: string;
}) {
  if (input.type === "hypothesis") {
    return updateHypothesis(
      input.id,
      { status: input.decision === "approve" ? "validated" : "rejected" },
      { humanUserId: input.humanUserId },
    );
  }
  if (input.type === "experiment") {
    return updateExperiment(
      input.id,
      { status: input.decision === "approve" ? "promoted" : "discarded" },
      { humanUserId: input.humanUserId },
    );
  }
  return updateSkill(
    input.id,
    { status: input.decision === "approve" ? "approved" : "deprecated" },
    { humanUserId: input.humanUserId },
  );
}
