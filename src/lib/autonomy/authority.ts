/**
 * Standing delegation: authority a human grants once, which then clears every
 * matching operation without another approval prompt.
 *
 * Pure and client-safe (no Prisma, no Node imports) so the full decision
 * matrix is unit-testable and the admin UI can explain a grant's coverage.
 *
 * Rules that never bend, whatever is configured:
 *  - Authority is always tenant-scoped: a grant only ever matches requests in
 *    its own workspace.
 *  - Absence of a grant is never permission. `evaluateAuthority` returns
 *    `authorized: false` with the exact missing authority, and the caller
 *    falls back to its existing approval path.
 *  - Consequential operations (external, deploy, publish, financial, legal,
 *    destructive, credential) must be named explicitly on a grant. The
 *    "routine" wildcard never covers them.
 *  - Any operation that costs money is only covered by a grant with an
 *    explicit budget that the cost fits inside.
 *  - Revoked, expired, not-yet-started and exhausted grants match nothing.
 */

export const ROUTINE_OPERATIONS = ["read", "write", "exec", "delegate"] as const;
export const CONSEQUENTIAL_OPERATIONS = ["external", "deploy", "publish", "financial", "legal", "destructive", "credential"] as const;
export const AUTHORITY_OPERATIONS = [...ROUTINE_OPERATIONS, ...CONSEQUENTIAL_OPERATIONS] as const;

export type RoutineOperation = (typeof ROUTINE_OPERATIONS)[number];
export type ConsequentialOperation = (typeof CONSEQUENTIAL_OPERATIONS)[number];
export type AuthorityOperation = (typeof AUTHORITY_OPERATIONS)[number];

/** What a grant may list: concrete operations, or the routine wildcard. */
export type GrantOperation = AuthorityOperation | "routine";

export type GrantPeriod = "day" | "week";

export interface AuthorityGrantLike {
  id: string;
  workspaceId: string;
  projectId: string | null;
  agentId: string | null;
  roomId: string | null;
  objectiveId: string | null;
  operations: readonly string[];
  /** Empty = any capability. Otherwise every requested capability must be listed. */
  capabilities: readonly string[];
  /** Empty = any runtime. */
  runtimes: readonly string[];
  maxUses: number | null;
  usesCount: number;
  budgetCents: number | null;
  spentCents: number;
  period: string | null;
  periodMaxUses: number | null;
  periodStartedAt: Date | null;
  periodUses: number;
  startsAt: Date | null;
  expiresAt: Date | null;
  revokedAt: Date | null;
}

export interface AuthorityRequest {
  workspaceId: string;
  projectId?: string | null;
  agentId: string;
  roomId?: string | null;
  objectiveId?: string | null;
  operation: AuthorityOperation;
  capabilities?: readonly string[];
  runtime?: string | null;
  /** Money this operation spends, in cents. 0 / undefined = free. */
  costCents?: number;
}

export interface AuthorityDecision {
  authorized: boolean;
  grant: AuthorityGrantLike | null;
  /** Human-readable statement of exactly what authority is missing (empty when authorized). */
  missing: string;
  /** Per-grant reasons a candidate grant did not match, for the inspector. */
  rejections: { grantId: string; reason: string }[];
}

export function isConsequential(operation: string): operation is ConsequentialOperation {
  return (CONSEQUENTIAL_OPERATIONS as readonly string[]).includes(operation);
}

export function isAuthorityOperation(value: unknown): value is AuthorityOperation {
  return typeof value === "string" && (AUTHORITY_OPERATIONS as readonly string[]).includes(value);
}

/** Start of the recurring window containing `now` (UTC day / ISO week starting Monday). */
export function periodStart(period: GrantPeriod, now: Date): Date {
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  if (period === "week") {
    const day = start.getUTCDay(); // 0 = Sunday
    start.setUTCDate(start.getUTCDate() - ((day + 6) % 7));
  }
  return start;
}

/** Uses already spent in the grant's current recurring window. */
export function currentPeriodUses(grant: AuthorityGrantLike, now: Date): number {
  if (grant.period !== "day" && grant.period !== "week") return 0;
  if (!grant.periodStartedAt) return 0;
  return grant.periodStartedAt.getTime() >= periodStart(grant.period, now).getTime() ? grant.periodUses : 0;
}

function coversOperation(grant: AuthorityGrantLike, operation: AuthorityOperation): boolean {
  if (grant.operations.includes(operation)) return true;
  return !isConsequential(operation) && grant.operations.includes("routine");
}

/** Why `grant` does not cover `request`, or null when it does. */
export function grantRejection(grant: AuthorityGrantLike, request: AuthorityRequest, now: Date): string | null {
  if (grant.workspaceId !== request.workspaceId) return "different workspace";
  if (grant.revokedAt) return "revoked";
  if (grant.startsAt && grant.startsAt.getTime() > now.getTime()) return "not yet active";
  if (grant.expiresAt && grant.expiresAt.getTime() <= now.getTime()) return "expired";
  if (grant.projectId && grant.projectId !== (request.projectId ?? null)) return `limited to project ${grant.projectId}`;
  if (grant.agentId && grant.agentId !== request.agentId) return `limited to agent ${grant.agentId}`;
  if (grant.roomId && grant.roomId !== (request.roomId ?? null)) return `limited to room ${grant.roomId}`;
  if (grant.objectiveId && grant.objectiveId !== (request.objectiveId ?? null)) return `limited to objective ${grant.objectiveId}`;
  if (!coversOperation(grant, request.operation)) {
    return isConsequential(request.operation) && grant.operations.includes("routine")
      ? `"${request.operation}" must be granted explicitly; "routine" does not cover it`
      : `does not cover "${request.operation}"`;
  }
  const capabilities = request.capabilities ?? [];
  if (grant.capabilities.length > 0) {
    if (capabilities.length === 0) return "limited to specific capabilities; request declares none";
    const outside = capabilities.filter((capability) => !grant.capabilities.includes(capability));
    if (outside.length) return `does not cover capabilities ${outside.join(", ")}`;
  }
  if (grant.runtimes.length > 0 && (!request.runtime || !grant.runtimes.includes(request.runtime))) {
    return `limited to runtimes ${grant.runtimes.join(", ")}`;
  }
  if (grant.maxUses !== null && grant.usesCount >= grant.maxUses) return "use limit reached";
  if (grant.periodMaxUses !== null && currentPeriodUses(grant, now) >= grant.periodMaxUses) return `${grant.period ?? "period"} use limit reached`;
  const cost = Math.max(0, Math.round(request.costCents ?? 0));
  if (request.operation === "financial" && grant.budgetCents === null) return "financial authority requires an explicit budget";
  if (cost > 0) {
    if (grant.budgetCents === null) return "operation spends money; grant has no budget";
    if (grant.spentCents + cost > grant.budgetCents) return `budget exhausted (${grant.budgetCents - grant.spentCents}¢ left, ${cost}¢ needed)`;
  }
  return null;
}

/** More narrowing fields = more specific. The most specific matching grant is the one spent. */
function specificity(grant: AuthorityGrantLike): number {
  return [grant.projectId, grant.agentId, grant.roomId, grant.objectiveId].filter(Boolean).length * 10
    + (grant.capabilities.length ? 2 : 0) + (grant.runtimes.length ? 1 : 0)
    + (grant.maxUses !== null || grant.budgetCents !== null ? 1 : 0);
}

export function describeRequest(request: AuthorityRequest): string {
  const parts = [`"${request.operation}" for agent ${request.agentId}`];
  if (request.capabilities?.length) parts.push(`capabilities [${request.capabilities.join(", ")}]`);
  if (request.runtime) parts.push(`runtime ${request.runtime}`);
  if (request.projectId) parts.push(`project ${request.projectId}`);
  if (request.roomId) parts.push(`room ${request.roomId}`);
  if (request.objectiveId) parts.push(`objective ${request.objectiveId}`);
  if (request.costCents) parts.push(`spending ${request.costCents}¢`);
  return parts.join(", ");
}

export function evaluateAuthority(request: AuthorityRequest, grants: readonly AuthorityGrantLike[], now = new Date()): AuthorityDecision {
  const rejections: { grantId: string; reason: string }[] = [];
  const matching: AuthorityGrantLike[] = [];
  for (const grant of grants) {
    const reason = grantRejection(grant, request, now);
    if (reason) rejections.push({ grantId: grant.id, reason });
    else matching.push(grant);
  }
  if (matching.length) {
    const grant = [...matching].sort((a, b) => specificity(b) - specificity(a) || a.id.localeCompare(b.id))[0];
    return { authorized: true, grant, missing: "", rejections };
  }
  const nearest = rejections.filter((entry) => entry.reason !== "different workspace").slice(0, 3);
  const missing = `No standing authority covers ${describeRequest(request)}.`
    + (nearest.length ? ` Closest grants: ${nearest.map((entry) => `${entry.grantId} (${entry.reason})`).join("; ")}.` : " No grants exist in this scope.");
  return { authorized: false, grant: null, missing, rejections };
}

/** Map the orchestration action classes (action-policy.ts) and objective step impacts onto authority operations. */
export function operationForActionClass(actionClass: string): AuthorityOperation {
  return isAuthorityOperation(actionClass) ? actionClass : "write";
}

export function operationForStep(impact: string, kind: string): AuthorityOperation {
  if (impact === "read" && kind === "agent") return "delegate";
  if (impact === "write" && kind === "agent") return "delegate";
  return isAuthorityOperation(impact) ? impact : "write";
}

export interface GrantInputValidation {
  ok: boolean;
  errors: string[];
}

/** Shape checks for a grant someone is about to create (API boundary). */
export function validateGrantShape(input: { operations: readonly string[]; budgetCents: number | null; period: string | null; periodMaxUses: number | null; expiresAt: Date | null; startsAt: Date | null }): GrantInputValidation {
  const errors: string[] = [];
  if (!input.operations.length) errors.push("operations must list at least one operation");
  for (const operation of input.operations) {
    if (operation !== "routine" && !isAuthorityOperation(operation)) errors.push(`unknown operation "${operation}"`);
  }
  if (input.operations.includes("financial") && (input.budgetCents === null || input.budgetCents <= 0)) errors.push("financial authority requires a positive budgetCents");
  if (input.budgetCents !== null && (!Number.isInteger(input.budgetCents) || input.budgetCents < 0)) errors.push("budgetCents must be a non-negative integer");
  if (input.period !== null && input.period !== "day" && input.period !== "week") errors.push('period must be "day" or "week"');
  if ((input.period === null) !== (input.periodMaxUses === null)) errors.push("period and periodMaxUses go together");
  if (input.startsAt && input.expiresAt && input.expiresAt <= input.startsAt) errors.push("expiresAt must be after startsAt");
  return { ok: errors.length === 0, errors };
}
