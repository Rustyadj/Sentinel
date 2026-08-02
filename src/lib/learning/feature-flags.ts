import { createHash } from "node:crypto";
import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import {
  assertRiskTransitionAuthorized,
  classifyRiskLevel,
} from "@/lib/neural-engine/policy-service";
import type { LearningCandidateType, RiskLevel } from "@/lib/neural-engine/types";

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

export interface FeatureFlagMutationOptions {
  authorizedByUserId?: string;
}

export async function createFeatureFlag(
  input: CreateFeatureFlagInput,
  options: FeatureFlagMutationOptions = {},
) {
  const scopeType = input.scopeType ?? "global";
  validateScope(scopeType, input.scopeId);
  const rolloutPercentage = validateRollout(input.rolloutPercentage ?? 0);
  const enabled = input.enabled ?? false;
  const riskTier = validateRiskTier(input.riskTier ?? "low");

  return db.$transaction(async (tx) => {
    const classification = await classifyFeatureFlagRisk(
      tx,
      input.learningCandidateId ?? null,
      riskTier,
    );
    await authorizeFeatureFlagExpansion(tx, {
      classification,
      authorizedByUserId: options.authorizedByUserId,
      expandsRollout: enabled && rolloutPercentage > 0,
      learningCandidateId: input.learningCandidateId ?? null,
    });
    return tx.featureFlag.create({
      data: {
        key: requiredText(input.key, "key"),
        name: requiredText(input.name, "name"),
        description: input.description ?? null,
        scopeType,
        scopeId: scopeType === "global" ? null : input.scopeId!.trim(),
        enabled,
        rolloutPercentage,
        variant: input.variant ?? null,
        config: (input.config ?? {}) as Prisma.InputJsonValue,
        riskTier,
        learningCandidateId: input.learningCandidateId ?? null,
      },
    });
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

export async function updateFeatureFlag(
  id: string,
  input: UpdateFeatureFlagInput,
  options: FeatureFlagMutationOptions = {},
) {
  return db.$transaction(async (tx) => {
    const current = await tx.featureFlag.findUniqueOrThrow({ where: { id } });
    const scopeType = input.scopeType ?? (current.scopeType as FeatureFlagScopeType);
    const scopeId = input.scopeId !== undefined ? input.scopeId : current.scopeId;
    const enabled = input.enabled ?? current.enabled;
    const rolloutPercentage =
      input.rolloutPercentage !== undefined
        ? validateRollout(input.rolloutPercentage)
        : current.rolloutPercentage;
    const riskTier = validateRiskTier(input.riskTier ?? current.riskTier);
    const learningCandidateId =
      input.learningCandidateId !== undefined
        ? input.learningCandidateId
        : current.learningCandidateId;
    validateScope(scopeType, scopeId);

    const [currentClassification, nextClassification] = await Promise.all([
      classifyFeatureFlagRisk(
        tx,
        current.learningCandidateId,
        validateRiskTier(current.riskTier),
      ),
      classifyFeatureFlagRisk(
        tx,
        learningCandidateId,
        riskTier,
      ),
    ]);
    const classification = stricterClassification(currentClassification, nextClassification);
    const changesActiveDeployment =
      enabled &&
      rolloutPercentage > 0 &&
      (
        !current.enabled ||
        rolloutPercentage > current.rolloutPercentage ||
        scopeType !== current.scopeType ||
        scopeId !== current.scopeId ||
        learningCandidateId !== current.learningCandidateId ||
        input.variant !== undefined ||
        input.config !== undefined ||
        input.riskTier !== undefined
      );
    await authorizeFeatureFlagExpansion(tx, {
      classification,
      authorizedByUserId: options.authorizedByUserId,
      expandsRollout: changesActiveDeployment,
      learningCandidateId,
    });

    return tx.featureFlag.update({
      where: { id },
      data: {
        ...(input.name !== undefined ? { name: requiredText(input.name, "name") } : {}),
        ...(input.description !== undefined ? { description: input.description } : {}),
        ...(input.scopeType !== undefined ? { scopeType } : {}),
        ...(input.scopeType !== undefined || input.scopeId !== undefined
          ? { scopeId: scopeType === "global" ? null : scopeId!.trim() }
          : {}),
        ...(input.enabled !== undefined ? { enabled: input.enabled } : {}),
        ...(input.rolloutPercentage !== undefined ? { rolloutPercentage } : {}),
        ...(input.variant !== undefined ? { variant: input.variant } : {}),
        ...(input.config !== undefined ? { config: input.config as Prisma.InputJsonValue } : {}),
        ...(input.riskTier !== undefined ? { riskTier } : {}),
        ...(input.learningCandidateId !== undefined ? { learningCandidateId } : {}),
      },
    });
  });
}

export function deleteFeatureFlag(id: string) {
  return db.$transaction(async (tx) => {
    const flag = await tx.featureFlag.findUniqueOrThrow({ where: { id } });
    const classification = await classifyFeatureFlagRisk(
      tx,
      flag.learningCandidateId,
      validateRiskTier(flag.riskTier),
    );
    assertRiskTransitionAuthorized({
      classification,
      transition: "Feature-flag deletion",
      humanAuthorized: false,
      riskReducing: true,
    });
    return tx.featureFlag.delete({ where: { id } });
  });
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

function validateRiskTier(value: string): RiskLevel {
  const normalized = value.trim().toLowerCase();
  if (normalized !== "low" && normalized !== "medium" && normalized !== "high") {
    throw new Error("riskTier must be low, medium, or high");
  }
  return normalized;
}

async function classifyFeatureFlagRisk(
  tx: Prisma.TransactionClient,
  learningCandidateId: string | null,
  riskTier: RiskLevel,
) {
  if (!learningCandidateId) return classifyRiskLevel("feature_flag", riskTier);
  const candidate = await tx.learningCandidate.findUniqueOrThrow({
    where: { id: learningCandidateId },
    select: { type: true, riskLevel: true },
  });
  return classifyRiskLevel(
    candidate.type as LearningCandidateType,
    candidate.riskLevel as RiskLevel,
  );
}

async function authorizeFeatureFlagExpansion(
  tx: Prisma.TransactionClient,
  input: {
    classification: ReturnType<typeof classifyRiskLevel>;
    authorizedByUserId?: string;
    expandsRollout: boolean;
    learningCandidateId: string | null;
  },
) {
  if (!input.expandsRollout) {
    assertRiskTransitionAuthorized({
      classification: input.classification,
      transition: "Feature-flag risk-reducing change",
      humanAuthorized: false,
      riskReducing: true,
    });
    return;
  }

  if (input.learningCandidateId) {
    const candidate = await tx.learningCandidate.findUniqueOrThrow({
      where: { id: input.learningCandidateId },
      select: { status: true, appliedTargetId: true },
    });
    if (
      (candidate.status !== "approved" && candidate.status !== "auto_approved") ||
      !candidate.appliedTargetId
    ) {
      throw new Error("A feature flag cannot deploy a learning candidate before it is approved and applied.");
    }
  }

  const humanAuthorized = input.authorizedByUserId
    ? Boolean(await tx.user.findUnique({
        where: { id: input.authorizedByUserId },
        select: { id: true },
      }))
    : false;
  assertRiskTransitionAuthorized({
    classification: input.classification,
    transition: "Feature-flag rollout expansion",
    humanAuthorized,
  });
}

function stricterClassification<T extends ReturnType<typeof classifyRiskLevel>>(
  left: T,
  right: T,
): T {
  const rank: Record<RiskLevel, number> = { low: 1, medium: 2, high: 3 };
  if (rank[left.riskLevel] !== rank[right.riskLevel]) {
    return rank[left.riskLevel] > rank[right.riskLevel] ? left : right;
  }
  return !left.autoApproveEligible ? left : right;
}

function requiredText(value: string, field: string): string {
  const normalized = value.trim();
  if (!normalized) throw new Error(`${field} is required`);
  return normalized;
}
