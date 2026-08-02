import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import {
  requireLearningAgentAccess,
  requireLearningWorkspaceAccess,
} from "./authorization";

export type LearningSettingsScopeType = "organization" | "workspace" | "agent";

const SCOPE_TYPES: ReadonlySet<string> = new Set(["organization", "workspace", "agent"]);

export interface LearningSettingsFields {
  curiosityThreshold?: number | null;
  minShadowSampleSize?: number | null;
  benchmarkThresholds?: Record<string, number> | null;
  trustThresholds?: Record<string, number> | null;
  rolloutSteps?: number[];
  dailyLearningBudgetUsd?: number | null;
  perAgentBudgetUsd?: number | null;
  replayLimits?: Record<string, number> | null;
  modelAllowlist?: string[];
  maxSandboxConcurrency?: number | null;
  autoDeployEnabled?: boolean;
}

// Hardcoded system defaults — the last fallback when no scope has ever set
// a value. Mirrors the constants already hardcoded elsewhere in this branch
// (shadow.ts's MIN_SHADOW_SAMPLE_SIZE=5, curiosity.ts's
// CURIOSITY_ASK_THRESHOLD=0.6) so settings can override real existing
// behavior rather than introducing parallel unused numbers.
const SYSTEM_DEFAULTS: Required<Omit<LearningSettingsFields, "benchmarkThresholds" | "trustThresholds" | "replayLimits">> & {
  benchmarkThresholds: Record<string, number>;
  trustThresholds: Record<string, number>;
  replayLimits: Record<string, number>;
} = {
  curiosityThreshold: 0.6,
  minShadowSampleSize: 5,
  benchmarkThresholds: { accuracy: 0.7, maxCostUsd: 1, maxLatencyMs: 10_000 },
  trustThresholds: { autoApproveMinScore: 0.8 },
  rolloutSteps: [10, 25, 50, 100],
  dailyLearningBudgetUsd: 50,
  perAgentBudgetUsd: 10,
  replayLimits: { maxPerCategory: 50, lookbackDays: 30 },
  modelAllowlist: [],
  maxSandboxConcurrency: 2,
  autoDeployEnabled: false,
};

function validateScope(scopeType: string, scopeId: string) {
  if (!SCOPE_TYPES.has(scopeType)) {
    throw new Error(`Unsupported learning settings scope type: ${scopeType}`);
  }
  if (!scopeId.trim()) throw new Error("scopeId is required");
}

export function getLearningSettings(scopeType: LearningSettingsScopeType, scopeId: string) {
  return db.learningSettings.findUnique({ where: { scopeType_scopeId: { scopeType, scopeId } } });
}

export async function upsertLearningSettings(
  scopeType: LearningSettingsScopeType,
  scopeId: string,
  input: LearningSettingsFields,
  options: { updatedByUserId?: string } = {},
) {
  validateScope(scopeType, scopeId);
  if (input.curiosityThreshold != null && (input.curiosityThreshold < 0 || input.curiosityThreshold > 1)) {
    throw new Error("curiosityThreshold must be between 0 and 1");
  }
  if (input.minShadowSampleSize != null && input.minShadowSampleSize < 1) {
    throw new Error("minShadowSampleSize must be at least 1");
  }
  if (input.maxSandboxConcurrency != null && input.maxSandboxConcurrency < 1) {
    throw new Error("maxSandboxConcurrency must be at least 1");
  }
  if (input.dailyLearningBudgetUsd != null && input.dailyLearningBudgetUsd < 0) {
    throw new Error("dailyLearningBudgetUsd cannot be negative");
  }
  if (input.perAgentBudgetUsd != null && input.perAgentBudgetUsd < 0) {
    throw new Error("perAgentBudgetUsd cannot be negative");
  }

  const data = {
    scopeType,
    scopeId,
    ...input,
    benchmarkThresholds: (input.benchmarkThresholds ?? undefined) as Prisma.InputJsonValue | undefined,
    trustThresholds: (input.trustThresholds ?? undefined) as Prisma.InputJsonValue | undefined,
    replayLimits: (input.replayLimits ?? undefined) as Prisma.InputJsonValue | undefined,
    updatedByUserId: options.updatedByUserId ?? null,
  };

  return db.learningSettings.upsert({
    where: { scopeType_scopeId: { scopeType, scopeId } },
    create: data,
    update: data,
  });
}

/** Server-side authorization gate — call before reading/writing a given scope on behalf of a user. */
export async function requireLearningSettingsAccess(
  userId: string,
  scopeType: LearningSettingsScopeType,
  scopeId: string,
  permission: string,
) {
  if (scopeType === "agent") {
    await requireLearningAgentAccess(userId, scopeId, permission);
    return;
  }
  if (scopeType === "workspace") {
    await requireLearningWorkspaceAccess(userId, scopeId, permission);
    return;
  }
  // "organization" has no resolvable authority in this repo (same gap
  // documented for FeatureFlag's global/organization scope) — fail closed
  // rather than grant broad access nobody was actually authorized for.
  throw new Error(`No authorization path exists for learning settings scope "${scopeType}" in this repository yet.`);
}

/**
 * Effective settings for a given agent: agent-level overrides win over
 * workspace, which wins over organization, which wins over hardcoded
 * system defaults. Merges field-by-field, not row-by-row — a workspace
 * that only sets autoDeployEnabled shouldn't blank out an org-level
 * curiosityThreshold.
 */
export async function getEffectiveLearningSettings(agentId: string) {
  const agent = await db.agent.findUnique({
    where: { id: agentId },
    select: { workspaceId: true },
  });
  const workspaceId = agent?.workspaceId ?? null;
  const organizationId = workspaceId
    ? (await db.workspace.findUnique({ where: { id: workspaceId }, select: { organizationId: true } }))?.organizationId ?? null
    : null;

  const [orgSettings, workspaceSettings, agentSettings] = await Promise.all([
    organizationId ? getLearningSettings("organization", organizationId) : null,
    workspaceId ? getLearningSettings("workspace", workspaceId) : null,
    getLearningSettings("agent", agentId),
  ]);

  const layers = [SYSTEM_DEFAULTS, orgSettings, workspaceSettings, agentSettings];
  const merged: Record<string, unknown> = {};
  for (const layer of layers) {
    if (!layer) continue;
    for (const [key, value] of Object.entries(layer)) {
      if (value === null || value === undefined) continue;
      if (["id", "scopeType", "scopeId", "createdAt", "updatedAt", "updatedByUserId"].includes(key)) continue;
      merged[key] = value;
    }
  }
  return merged as LearningSettingsFields;
}
