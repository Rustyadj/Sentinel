import { createHash } from "node:crypto";
import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";

export type FeatureFlagScopeType =
  | "global"
  | "organization"
  | "workspace"
  | "project"
  | "user"
  | "agent";

const FEATURE_FLAG_SCOPE_TYPES: ReadonlySet<string> = new Set([
  "global",
  "organization",
  "workspace",
  "project",
  "user",
  "agent",
]);

export interface CreateFeatureFlagInput {
  key: string;
  name: string;
  description?: string | null;
  scopeType?: FeatureFlagScopeType;
  scopeId?: string | null;
  enabled?: boolean;
  rolloutPercentage?: number;
  variant?: string | null;
  config?: Record<string, unknown>;
  riskTier?: string;
  learningCandidateId?: string | null;
}

export interface UpdateFeatureFlagInput {
  name?: string;
  description?: string | null;
  scopeType?: FeatureFlagScopeType;
  scopeId?: string | null;
  enabled?: boolean;
  rolloutPercentage?: number;
  variant?: string | null;
  config?: Record<string, unknown>;
  riskTier?: string;
  learningCandidateId?: string | null;
}

export interface FeatureFlagContext {
  organizationId?: string;
  workspaceId?: string;
  projectId?: string;
  userId?: string;
  agentId?: string;
}

export function createFeatureFlag(input: CreateFeatureFlagInput) {
  const scopeType = input.scopeType ?? "global";
  validateScope(scopeType, input.scopeId);
  return db.featureFlag.create({
    data: {
      key: requiredText(input.key, "key"),
      name: requiredText(input.name, "name"),
      description: input.description ?? null,
      scopeType,
      scopeId: scopeType === "global" ? null : input.scopeId!.trim(),
      enabled: input.enabled ?? false,
      rolloutPercentage: validateRollout(input.rolloutPercentage ?? 0),
      variant: input.variant ?? null,
      config: (input.config ?? {}) as Prisma.InputJsonValue,
      riskTier: input.riskTier?.trim() || "low",
      learningCandidateId: input.learningCandidateId ?? null,
    },
  });
}

export function listFeatureFlags(params: { scopeType?: string; scopeId?: string } = {}) {
  return db.featureFlag.findMany({
    where: {
      ...(params.scopeType ? { scopeType: params.scopeType } : {}),
      ...(params.scopeId ? { scopeId: params.scopeId } : {}),
    },
    orderBy: { key: "asc" },
  });
}

export function getFeatureFlag(id: string) {
  return db.featureFlag.findUnique({ where: { id } });
}

export async function updateFeatureFlag(id: string, input: UpdateFeatureFlagInput) {
  const current = await db.featureFlag.findUniqueOrThrow({ where: { id } });
  const scopeType = input.scopeType ?? (current.scopeType as FeatureFlagScopeType);
  const scopeId = input.scopeId !== undefined ? input.scopeId : current.scopeId;
  validateScope(scopeType, scopeId);
  return db.featureFlag.update({
    where: { id },
    data: {
      ...(input.name !== undefined ? { name: requiredText(input.name, "name") } : {}),
      ...(input.description !== undefined ? { description: input.description } : {}),
      ...(input.scopeType !== undefined ? { scopeType } : {}),
      ...(input.scopeType !== undefined || input.scopeId !== undefined
        ? { scopeId: scopeType === "global" ? null : scopeId!.trim() }
        : {}),
      ...(input.enabled !== undefined ? { enabled: input.enabled } : {}),
      ...(input.rolloutPercentage !== undefined
        ? { rolloutPercentage: validateRollout(input.rolloutPercentage) }
        : {}),
      ...(input.variant !== undefined ? { variant: input.variant } : {}),
      ...(input.config !== undefined ? { config: input.config as Prisma.InputJsonValue } : {}),
      ...(input.riskTier !== undefined
        ? { riskTier: requiredText(input.riskTier, "riskTier") }
        : {}),
      ...(input.learningCandidateId !== undefined
        ? { learningCandidateId: input.learningCandidateId }
        : {}),
    },
  });
}

export function deleteFeatureFlag(id: string) {
  return db.featureFlag.delete({ where: { id } });
}

/** Stable 0–99 bucket for deterministic percentage rollouts. */
export function getFeatureFlagBucket(key: string, assignmentId: string): number {
  const digest = createHash("sha256").update(`${key}:${assignmentId}`).digest();
  return digest.readUInt32BE(0) % 100;
}

export async function evaluateFlag(key: string, context: FeatureFlagContext): Promise<boolean> {
  const flag = await db.featureFlag.findUnique({ where: { key: key.trim() } });
  if (!flag || !flag.enabled) return false;
  if (!scopeMatches(flag.scopeType as FeatureFlagScopeType, flag.scopeId, context)) return false;
  if (flag.rolloutPercentage <= 0) return false;
  if (flag.rolloutPercentage >= 100) return true;

  const assignmentId = assignmentIdFor(flag.scopeType as FeatureFlagScopeType, context);
  if (!assignmentId) return false;
  return getFeatureFlagBucket(flag.key, assignmentId) < flag.rolloutPercentage;
}

function scopeMatches(
  scopeType: FeatureFlagScopeType,
  scopeId: string | null,
  context: FeatureFlagContext,
): boolean {
  switch (scopeType) {
    case "global": return true;
    case "organization": return scopeId === context.organizationId;
    case "workspace": return scopeId === context.workspaceId;
    case "project": return scopeId === context.projectId;
    case "user": return scopeId === context.userId;
    case "agent": return scopeId === context.agentId;
  }
}

function assignmentIdFor(
  scopeType: FeatureFlagScopeType,
  context: FeatureFlagContext,
): string | undefined {
  if (context.userId) return context.userId;
  if (context.agentId) return context.agentId;
  switch (scopeType) {
    case "organization": return context.organizationId;
    case "workspace": return context.workspaceId;
    case "project": return context.projectId;
    case "user": return context.userId;
    case "agent": return context.agentId;
    case "global": return undefined;
  }
}

function validateScope(scopeType: FeatureFlagScopeType, scopeId?: string | null) {
  if (!FEATURE_FLAG_SCOPE_TYPES.has(scopeType)) {
    throw new Error(`Unsupported feature flag scope type: ${scopeType}`);
  }
  if (scopeType !== "global" && !scopeId?.trim()) {
    throw new Error(`scopeId is required for ${scopeType} feature flags`);
  }
}

function validateRollout(value: number): number {
  if (!Number.isInteger(value) || value < 0 || value > 100) {
    throw new Error("rolloutPercentage must be an integer from 0 to 100");
  }
  return value;
}

function requiredText(value: string, field: string): string {
  const normalized = value.trim();
  if (!normalized) throw new Error(`${field} is required`);
  return normalized;
}
