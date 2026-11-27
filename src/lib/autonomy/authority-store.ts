import type { AuthorityGrant, Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { logger } from "@/lib/logger";
import {
  currentPeriodUses,
  evaluateAuthority,
  periodStart,
  validateGrantShape,
  type AuthorityDecision,
  type AuthorityRequest,
  type GrantPeriod,
} from "./authority";
import { getAutonomySettings } from "./settings-store";

export interface AuthorizationSubject {
  /** task | objective_step | guardian_review | bot_tool | ... */
  type: string;
  id: string;
  /** Stable per logical action. A retry with the same key reuses the original use instead of spending twice. */
  correlationId?: string | null;
}

export interface AuthorizationOutcome extends AuthorityDecision {
  useId: string | null;
  /** True when standing delegation is switched off for this agent/workspace. */
  delegationDisabled: boolean;
}

export async function listActiveGrants(workspaceId: string, now = new Date()): Promise<AuthorityGrant[]> {
  return db.authorityGrant.findMany({
    where: { workspaceId, revokedAt: null, OR: [{ expiresAt: null }, { expiresAt: { gt: now } }] },
    orderBy: { createdAt: "asc" },
  });
}

/**
 * Check standing authority for one operation and, when covered, spend it
 * atomically and record provenance. Never throws for "not covered" — the
 * caller keeps its existing approval path, now told exactly what is missing.
 */
export interface AuthorizeOptions {
  /** Restrict which grants may apply (e.g. only grants scoped to one objective). */
  grantFilter?: (grant: AuthorityGrant) => boolean;
  now?: Date;
}

export async function authorizeOperation(request: AuthorityRequest, subject: AuthorizationSubject, options: AuthorizeOptions = {}): Promise<AuthorizationOutcome> {
  const now = options.now ?? new Date();
  const settings = await getAutonomySettings(request.workspaceId, request.agentId);
  if (!settings.standingDelegation) {
    return { authorized: false, grant: null, missing: "Standing delegation is disabled for this agent; each gated action needs an individual approval.", rejections: [], useId: null, delegationDisabled: true };
  }

  if (subject.correlationId) {
    const prior = await db.authorityGrantUse.findFirst({
      where: { workspaceId: request.workspaceId, subjectType: subject.type, subjectId: subject.id, correlationId: subject.correlationId, operation: request.operation },
      include: { grant: true },
    });
    if (prior && !prior.grant.revokedAt && (!prior.grant.expiresAt || prior.grant.expiresAt > now) && (options.grantFilter?.(prior.grant) ?? true)) return { authorized: true, grant: prior.grant, missing: "", rejections: [], useId: prior.id, delegationDisabled: false };
  }

  const grants = (await listActiveGrants(request.workspaceId, now)).filter(options.grantFilter ?? (() => true));
  const decision = evaluateAuthority(request, grants, now);
  if (!decision.authorized || !decision.grant) return { ...decision, useId: null, delegationDisabled: false };

  const grant = decision.grant as AuthorityGrant;
  const cost = Math.max(0, Math.round(request.costCents ?? 0));
  try {
    const useId = await db.$transaction(async (tx) => {
      const where: Prisma.AuthorityGrantWhereInput = { id: grant.id, revokedAt: null };
      const and: Prisma.AuthorityGrantWhereInput[] = [];
      if (grant.maxUses !== null) and.push({ usesCount: { lt: grant.maxUses } });
      if (grant.budgetCents !== null && cost > 0) and.push({ spentCents: { lte: grant.budgetCents - cost } });
      const data: Prisma.AuthorityGrantUpdateManyMutationInput = { usesCount: { increment: 1 }, ...(cost ? { spentCents: { increment: cost } } : {}) };
      if (grant.period === "day" || grant.period === "week") {
        const windowStart = periodStart(grant.period as GrantPeriod, now);
        if (currentPeriodUses(grant, now) === 0) {
          data.periodStartedAt = windowStart;
          data.periodUses = 1;
          and.push({ OR: [{ periodStartedAt: null }, { periodStartedAt: { lt: windowStart } }, { periodUses: 0 }] });
        } else {
          data.periodUses = { increment: 1 };
          and.push({ periodStartedAt: { gte: windowStart } });
          if (grant.periodMaxUses !== null) and.push({ periodUses: { lt: grant.periodMaxUses } });
        }
      }
      const updated = await tx.authorityGrant.updateMany({ where: { ...where, AND: and }, data });
      if (updated.count !== 1) return null;
      const use = await tx.authorityGrantUse.create({
        data: {
          grantId: grant.id, workspaceId: request.workspaceId, agentId: request.agentId, operation: request.operation,
          subjectType: subject.type, subjectId: subject.id, costCents: cost, correlationId: subject.correlationId ?? null,
        },
      });
      return use.id;
    });
    if (!useId) {
      return { authorized: false, grant: null, missing: `Grant ${grant.id} was exhausted or revoked concurrently; no standing authority remains for "${request.operation}".`, rejections: decision.rejections, useId: null, delegationDisabled: false };
    }
    return { ...decision, useId, delegationDisabled: false };
  } catch (error) {
    // Fail closed: an authority bookkeeping error must not silently authorize.
    logger.warn("autonomy.authority_consume_failed", { error: error instanceof Error ? error.message : String(error), grantId: grant.id });
    return { authorized: false, grant: null, missing: "Standing authority could not be recorded; falling back to approval.", rejections: decision.rejections, useId: null, delegationDisabled: false };
  }
}

export interface CreateGrantInput {
  workspaceId: string;
  grantedByUserId: string;
  operations: string[];
  projectId?: string | null;
  agentId?: string | null;
  roomId?: string | null;
  objectiveId?: string | null;
  capabilities?: string[];
  runtimes?: string[];
  maxUses?: number | null;
  budgetCents?: number | null;
  period?: string | null;
  periodMaxUses?: number | null;
  startsAt?: Date | null;
  expiresAt?: Date | null;
  reason?: string;
}

export class GrantValidationError extends Error {
  constructor(public readonly errors: string[]) { super(errors.join("; ")); this.name = "GrantValidationError"; }
}

export async function createGrant(input: CreateGrantInput): Promise<AuthorityGrant> {
  const shape = {
    operations: input.operations, budgetCents: input.budgetCents ?? null, period: input.period ?? null,
    periodMaxUses: input.periodMaxUses ?? null, startsAt: input.startsAt ?? null, expiresAt: input.expiresAt ?? null,
  };
  const validation = validateGrantShape(shape);
  if (!validation.ok) throw new GrantValidationError(validation.errors);
  return db.authorityGrant.create({
    data: {
      workspaceId: input.workspaceId, grantedByUserId: input.grantedByUserId, operations: [...new Set(input.operations)],
      projectId: input.projectId ?? null, agentId: input.agentId ?? null, roomId: input.roomId ?? null, objectiveId: input.objectiveId ?? null,
      capabilities: input.capabilities ?? [], runtimes: input.runtimes ?? [], maxUses: input.maxUses ?? null,
      budgetCents: shape.budgetCents, period: shape.period, periodMaxUses: shape.periodMaxUses,
      startsAt: shape.startsAt, expiresAt: shape.expiresAt, reason: input.reason ?? "",
    },
  });
}

/** Revocation is immediate and permanent for that grant: every later evaluation rejects it. */
export async function revokeGrant(input: { grantId: string; workspaceId: string; userId: string; reason?: string }): Promise<boolean> {
  const result = await db.authorityGrant.updateMany({
    where: { id: input.grantId, workspaceId: input.workspaceId, revokedAt: null },
    data: { revokedAt: new Date(), revokedByUserId: input.userId, revokeReason: input.reason ?? null },
  });
  return result.count === 1;
}
