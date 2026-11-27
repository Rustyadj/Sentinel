import { createHash } from "node:crypto";
import type { Objective, ObjectiveStep, Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { writeAuditLog } from "@/lib/workspaces/audit";
import { consumeApproval } from "@/lib/orchestration/approval-binding";
import { allowedAttempts, decideStep, parseAutonomyLevel, retryDelayMs } from "./policy";
import { authorizeOperation } from "@/lib/autonomy/authority-store";
import { operationForStep } from "@/lib/autonomy/authority";
import { getAutonomySettings } from "@/lib/autonomy/settings-store";
import { RUNS_AFTER_SETTLED_DEPENDENCIES } from "./planner";
import { roleAllowsTool } from "./roles";
import { getTool, type DependencyState, type ToolContext, type ToolDeps, type ToolResult } from "./tools";
import {
  ACTIVE_OBJECTIVE_STATUSES, OBJECTIVE_APPROVAL_TYPE, SETTLED_STEP_STATUSES,
  type CompletionReport, type CompletionReportItem, type ObjectiveStatus, type StepImpact, type StepKind, type StepStatus,
} from "./types";

/**
 * The objective engine. All state lives in Postgres; a worker holds a short
 * lease on an objective while it advances it, so a crash or restart simply
 * lets the lease expire and the next tick (any worker) carries on from the
 * last persisted step state. A step found `running` without a live agent run
 * is re-executed with the same idempotency key — tools and adapters must be
 * idempotent on it (integrations.ts).
 */

const LEASE_MS = 120_000;
const MAX_PASSES = 12;
const STEP_CONCURRENCY = 4;

const json = (value: unknown) => value as Prisma.InputJsonValue;
const asRecord = (value: unknown): Record<string, unknown> => (value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {});

export function objectivesEnabled(): boolean {
  return process.env.SENTINEL_OBJECTIVES === "on";
}

export async function recordEvent(objectiveId: string, type: string, message: string, stepKey?: string | null, data: Record<string, unknown> = {}) {
  await db.objectiveEvent.create({ data: { objectiveId, type, message: message.slice(0, 2000), stepKey: stepKey ?? null, data: json(data) } });
}

// --- leasing -------------------------------------------------------------------

export async function claimObjective(objectiveId: string, workerId: string, now = new Date()): Promise<boolean> {
  const claimed = await db.objective.updateMany({
    where: { id: objectiveId, status: { in: [...ACTIVE_OBJECTIVE_STATUSES] }, OR: [{ leaseExpiresAt: null }, { leaseExpiresAt: { lt: now } }, { leaseOwner: workerId }] },
    data: { leaseOwner: workerId, leaseExpiresAt: new Date(now.getTime() + LEASE_MS) },
  });
  return claimed.count === 1;
}

export async function releaseObjective(objectiveId: string, workerId: string) {
  await db.objective.updateMany({ where: { id: objectiveId, leaseOwner: workerId }, data: { leaseOwner: null, leaseExpiresAt: null } });
}

/** One worker tick: advance every active objective whose lease is free. */
export async function tickObjectives(workerId: string, deps: ToolDeps, limit = 10): Promise<{ advanced: number }> {
  if (!objectivesEnabled()) return { advanced: 0 };
  const now = new Date();
  const candidates = await db.objective.findMany({
    where: { status: { in: [...ACTIVE_OBJECTIVE_STATUSES] }, OR: [{ leaseExpiresAt: null }, { leaseExpiresAt: { lt: now } }] },
    orderBy: { updatedAt: "asc" }, take: limit, select: { id: true },
  });
  let advanced = 0;
  for (const { id } of candidates) {
    if (!(await claimObjective(id, workerId))) continue;
    try {
      await advanceObjective(id, deps);
      advanced += 1;
    } catch (error) {
      await recordEvent(id, "engine.error", error instanceof Error ? error.message : "advance failed").catch(() => undefined);
    } finally {
      await releaseObjective(id, workerId);
    }
  }
  return { advanced };
}

// --- approvals -------------------------------------------------------------------

export function fingerprintStepAction(input: { objectiveId: string; stepKey: string; toolKey: string; impact: string; estimatedCostCents: number; preview: unknown }): string {
  const canonical = JSON.stringify([input.objectiveId, input.stepKey, input.toolKey, input.impact, input.estimatedCostCents, canonicalize(input.preview)]);
  return createHash("sha256").update(canonical).digest("hex");
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === "object") return Object.keys(value as object).sort().map((k) => [k, canonicalize((value as Record<string, unknown>)[k])]);
  return value ?? null;
}

/** What the human approves: the step plus the concrete values it will act on (e.g. which domain). */
function actionPreview(step: ObjectiveStep, ctx: ToolContext): Record<string, unknown> {
  const fromDeps: Record<string, unknown> = {};
  for (const [key, dep] of Object.entries(ctx.dependencies)) {
    const out = dep.output;
    for (const field of ["chosen", "domain", "siteId", "mxHosts"]) if (out[field] !== undefined) fromDeps[`${key}.${field}`] = out[field];
  }
  return { title: step.title, input: step.input, dependsOnValues: fromDeps };
}

// --- advancing -------------------------------------------------------------------

interface Loaded { objective: Objective; steps: ObjectiveStep[] }

async function load(objectiveId: string): Promise<Loaded> {
  const objective = await db.objective.findUniqueOrThrow({ where: { id: objectiveId } });
  const steps = await db.objectiveStep.findMany({ where: { objectiveId }, orderBy: { position: "asc" } });
  return { objective, steps };
}

function stateOf(step: ObjectiveStep): DependencyState & { title: string; kind: string } {
  return { status: step.status, output: asRecord(step.output), verification: asRecord(step.verification), title: step.title, kind: step.kind };
}

function contextFor(objective: Objective, step: ObjectiveStep, steps: ObjectiveStep[], deps: ToolDeps): ToolContext {
  const byKey = new Map(steps.map((s) => [s.key, s]));
  const dependencies: Record<string, DependencyState> = {};
  for (const key of step.dependsOn) { const dep = byKey.get(key); if (dep) dependencies[key] = stateOf(dep); }
  return {
    objective: { id: objective.id, workspaceId: objective.workspaceId, userId: objective.userId, inputs: asRecord(objective.inputs) },
    step: { key: step.key, input: asRecord(step.input), idempotencyKey: step.idempotencyKey, attempts: step.attempts, orchestrationRunId: step.orchestrationRunId },
    dependencies,
    allSteps: Object.fromEntries(steps.map((s) => [s.key, stateOf(s)])),
    deps,
  };
}

async function setStep(step: ObjectiveStep, data: Prisma.ObjectiveStepUpdateInput, event?: { type: string; message: string; data?: Record<string, unknown> }) {
  await db.objectiveStep.update({ where: { id: step.id }, data });
  if (event) await recordEvent(step.objectiveId, event.type, event.message, step.key, event.data);
}

async function applyResult(objective: Objective, step: ObjectiveStep, result: ToolResult, attemptNumber: number) {
  const level = parseAutonomyLevel(objective.autonomyLevel) ?? 2;
  switch (result.status) {
    case "completed": {
      if (!result.verification.passed) {
        return applyResult(objective, step, { status: "failed", error: "Tool returned completed without passing verification." }, attemptNumber);
      }
      const cost = Math.max(0, Math.round(result.costCents ?? 0));
      await db.$transaction([
        db.objectiveStep.update({ where: { id: step.id }, data: { status: "completed", output: json(result.output), verification: json(result.verification), error: null, blockedReason: null, unblockRequest: null, completedAt: new Date(), actualCostCents: { increment: cost } } }),
        db.objective.update({ where: { id: objective.id }, data: { spentCents: { increment: cost } } }),
      ]);
      await recordEvent(objective.id, "step.completed", `${step.title}: verified (${result.verification.checks.length} checks)`, step.key, { costCents: cost });
      return;
    }
    case "running":
      await setStep(step, { status: "running", ...(result.orchestrationRunId ? { orchestrationRunId: result.orchestrationRunId } : {}), ...(result.output ? { output: json(result.output) } : {}) },
        result.orchestrationRunId ? { type: "step.delegated", message: `${step.title}: delegated to orchestration run ${result.orchestrationRunId}`, data: { orchestrationRunId: result.orchestrationRunId } } : undefined);
      return;
    case "blocked":
      await setStep(step, { status: "blocked", blockedReason: result.reason, unblockRequest: result.unblockRequest }, { type: "step.blocked", message: `${step.title}: ${result.reason}` });
      return;
    case "retry": {
      const recovery = (await getAutonomySettings(objective.workspaceId).catch(() => null))?.maxRecoveryAttempts;
      const limit = allowedAttempts(level, step.maxAttempts, recovery);
      if (attemptNumber < limit) {
        const nextAttemptAt = new Date(Date.now() + retryDelayMs(attemptNumber));
        await setStep(step, { status: "retry_wait", error: result.error, nextAttemptAt, orchestrationRunId: null }, { type: "step.retry_scheduled", message: `${step.title}: ${result.error} — retry ${attemptNumber + 1}/${limit} at ${nextAttemptAt.toISOString()}` });
      } else {
        await setStep(step, { status: "failed", error: result.error }, { type: "step.failed", message: `${step.title}: ${result.error} (attempts exhausted: ${attemptNumber}/${limit})` });
      }
      return;
    }
    case "failed":
      await setStep(step, { status: "failed", error: result.error, ...(result.output ? { output: json(result.output) } : {}), ...(result.verification ? { verification: json(result.verification) } : {}) }, { type: "step.failed", message: `${step.title}: ${result.error}` });
      return;
  }
}

async function requestApproval(objective: Objective, step: ObjectiveStep, ctx: ToolContext, reason: string) {
  const preview = actionPreview(step, ctx);
  const fingerprint = fingerprintStepAction({ objectiveId: objective.id, stepKey: step.key, toolKey: step.toolKey, impact: step.impact, estimatedCostCents: step.estimatedCostCents, preview });
  const highImpact = ["financial", "legal", "destructive", "credential"].includes(step.impact);
  const approval = await db.approvalRequest.create({
    data: {
      workspaceId: objective.workspaceId, title: `${objective.title}: ${step.title}`.slice(0, 200), description: reason,
      type: OBJECTIVE_APPROVAL_TYPE, status: "pending", requesterUserId: objective.userId, taskId: step.id, risk: highImpact ? "high" : "medium",
      actionFingerprint: fingerprint,
      payload: json({ objectiveId: objective.id, stepKey: step.key, toolKey: step.toolKey, role: step.role, impact: step.impact, estimatedCostCents: step.estimatedCostCents, preview }),
    },
  });
  await setStep(step, { status: "waiting_approval", approvalRequestId: approval.id }, { type: "approval.requested", message: `${step.title}: approval requested — ${reason}`, data: { approvalRequestId: approval.id } });
  await writeAuditLog({ workspaceId: objective.workspaceId, userId: objective.userId, approvalRequestId: approval.id, actorType: "system", action: "objective.approval.requested", entityType: "objective_step", entityId: step.id, details: { objectiveId: objective.id, stepKey: step.key, impact: step.impact } });
}

/**
 * Standing delegation for one objective step: a grant covering the step's
 * operation (and fitting its cost inside the grant's own budget) clears it
 * without a per-step approval, and the use is recorded as provenance.
 * Supervised objectives only accept grants scoped to that exact objective.
 */
async function clearWithStandingAuthority(objective: Objective, step: ObjectiveStep, ctx: ToolContext, objectiveScopedOnly: boolean): Promise<{ cleared: boolean; missing: string | null }> {
  const preview = actionPreview(step, ctx);
  const fingerprint = fingerprintStepAction({ objectiveId: objective.id, stepKey: step.key, toolKey: step.toolKey, impact: step.impact, estimatedCostCents: step.estimatedCostCents, preview });
  const outcome = await authorizeOperation(
    { workspaceId: objective.workspaceId, agentId: `objective:${step.role}`, objectiveId: objective.id, operation: operationForStep(step.impact, step.kind), costCents: step.estimatedCostCents },
    { type: "objective_step", id: step.id, correlationId: fingerprint },
    objectiveScopedOnly ? { grantFilter: (grant) => grant.objectiveId === objective.id } : {},
  ).catch(() => null);
  if (!outcome?.authorized || !outcome.grant) return { cleared: false, missing: outcome?.missing ?? null };
  await setStep(step, { approvalClearedAt: new Date() }, {
    type: "authority.applied", message: `${step.title}: cleared by standing authority (grant ${outcome.grant.id})`,
    data: { grantId: outcome.grant.id, useId: outcome.useId, operation: operationForStep(step.impact, step.kind) },
  });
  await writeAuditLog({ workspaceId: objective.workspaceId, userId: objective.userId, actorType: "system", action: "objective.step.authorized_by_grant", entityType: "objective_step", entityId: step.id, details: { objectiveId: objective.id, stepKey: step.key, grantId: outcome.grant.id, impact: step.impact } });
  return { cleared: true, missing: null };
}

/** Re-check an approval-waiting step. Returns true when it is now cleared to run. */
async function settleApproval(objective: Objective, step: ObjectiveStep, ctx: ToolContext): Promise<boolean> {
  if (!step.approvalRequestId) { await setStep(step, { status: "pending" }); return false; }
  const approval = await db.approvalRequest.findUnique({ where: { id: step.approvalRequestId }, select: { status: true, decisionNote: true } });
  if (!approval || approval.status === "pending") return false;
  if (approval.status !== "approved") {
    await setStep(step, { status: "blocked", blockedReason: `Approval ${approval.status}${approval.decisionNote ? `: ${approval.decisionNote}` : ""}`, unblockRequest: "Retry this step to request a new approval, or leave it blocked." }, { type: "approval.rejected", message: `${step.title}: approval ${approval.status}` });
    return false;
  }
  // The approval clears exactly the action the human saw: if a dependency's
  // values changed since (e.g. a different domain), the fingerprint differs
  // and nothing is spent.
  const fingerprint = fingerprintStepAction({ objectiveId: objective.id, stepKey: step.key, toolKey: step.toolKey, impact: step.impact, estimatedCostCents: step.estimatedCostCents, preview: actionPreview(step, ctx) });
  const spent = await consumeApproval({ taskId: step.id, actionFingerprint: fingerprint, runId: objective.id });
  if (!spent) {
    await setStep(step, { status: "pending", approvalRequestId: null }, { type: "approval.stale", message: `${step.title}: the approved action no longer matches; a fresh approval is needed` });
    return false;
  }
  await setStep(step, { status: "pending", approvalClearedAt: new Date() }, { type: "approval.granted", message: `${step.title}: approval granted and spent` });
  return true;
}

function dependencyBlocker(step: ObjectiveStep, byKey: Map<string, ObjectiveStep>): { waiting: boolean; blockedBy: string | null } {
  const settledOnly = RUNS_AFTER_SETTLED_DEPENDENCIES.has(step.toolKey);
  let waiting = false;
  for (const key of step.dependsOn) {
    const dep = byKey.get(key);
    if (!dep) return { waiting: false, blockedBy: key };
    if (dep.status === "completed") continue;
    if (SETTLED_STEP_STATUSES.includes(dep.status as StepStatus)) { if (settledOnly) continue; return { waiting: false, blockedBy: key }; }
    waiting = true;
  }
  return { waiting, blockedBy: null };
}

async function executeStep(objective: Objective, step: ObjectiveStep, steps: ObjectiveStep[], deps: ToolDeps, polling: boolean) {
  const tool = getTool(step.toolKey);
  if (!tool || !roleAllowsTool(step.role, step.toolKey)) {
    await setStep(step, { status: "failed", error: tool ? `Role ${step.role} is not permitted to use ${step.toolKey}.` : `Unknown tool ${step.toolKey}.` }, { type: "step.failed", message: `${step.title}: tool not permitted` });
    return;
  }
  // Claim: only one executor may move this step forward.
  const attemptNumber = polling ? step.attempts : step.attempts + 1;
  const claimed = await db.objectiveStep.updateMany({
    where: { id: step.id, status: { in: ["pending", "running"] } },
    data: { status: "running", attempts: attemptNumber, startedAt: step.startedAt ?? new Date(), nextAttemptAt: null },
  });
  if (claimed.count === 0) return;
  if (!polling) await recordEvent(objective.id, "step.started", `${step.title} (attempt ${attemptNumber}) — ${step.role}`, step.key);
  const fresh = { ...step, attempts: attemptNumber };
  let result: ToolResult;
  try {
    result = await tool.execute(contextFor(objective, fresh, steps, deps));
  } catch (error) {
    result = { status: "retry", error: error instanceof Error ? error.message : "tool threw" };
  }
  await applyResult(objective, fresh, result, attemptNumber);
  if (["financial", "legal", "destructive", "credential", "publish"].includes(step.impact) && result.status === "completed") {
    await writeAuditLog({ workspaceId: objective.workspaceId, userId: objective.userId, actorType: "system", action: "objective.step.executed", entityType: "objective_step", entityId: step.id, details: { objectiveId: objective.id, stepKey: step.key, impact: step.impact, toolKey: step.toolKey } });
  }
}

/** One step's turn in a pass. Returns true when it changed state. */
async function advanceStep(objective: Objective, step: ObjectiveStep, steps: ObjectiveStep[], deps: ToolDeps, now: Date): Promise<"changed" | "unchanged" | { execute: boolean; polling: boolean }> {
  const byKey = new Map(steps.map((s) => [s.key, s]));
  if (step.status === "running") {
    // An agent run in flight is polled; anything else "running" was interrupted (crash/restart) and is re-run idempotently.
    return { execute: true, polling: Boolean(step.orchestrationRunId) };
  }
  if (step.status === "retry_wait") {
    if (step.nextAttemptAt && step.nextAttemptAt > now) return "unchanged";
    await setStep(step, { status: "pending" });
    return "changed";
  }
  const ctx = contextFor(objective, step, steps, deps);
  if (step.status === "waiting_approval") {
    return (await settleApproval(objective, step, ctx)) ? "changed" : (await db.objectiveStep.findUniqueOrThrow({ where: { id: step.id }, select: { status: true } })).status !== "waiting_approval" ? "changed" : "unchanged";
  }
  if (step.status !== "pending") return "unchanged";
  const { waiting, blockedBy } = dependencyBlocker(step, byKey);
  if (blockedBy) {
    const dep = byKey.get(blockedBy);
    await setStep(step, { status: "blocked", blockedReason: `dependency:${blockedBy}`, unblockRequest: `Waiting on "${dep?.title ?? blockedBy}" (${dep?.status ?? "missing"}). Resolve that step first.` }, { type: "step.blocked", message: `${step.title}: blocked by ${blockedBy}` });
    return "changed";
  }
  if (waiting) return "unchanged";

  const tool = getTool(step.toolKey);
  const pre = tool?.precheck?.(ctx);
  if (pre) { await applyResult(objective, step, pre, step.attempts); return "changed"; }

  if (!step.approvalClearedAt) {
    const decision = decideStep({
      level: parseAutonomyLevel(objective.autonomyLevel) ?? 2, kind: step.kind as StepKind, impact: step.impact as StepImpact,
      estimatedCostCents: step.estimatedCostCents, spentCents: objective.spentCents, budgetCents: objective.budgetCents,
    });
    if (decision.action === "advise") {
      await setStep(step, { status: "advised", blockedReason: decision.reason, unblockRequest: "Raise the objective's autonomy level to let Sentinel execute this, or do it manually." }, { type: "step.advised", message: `${step.title}: recommended, not executed (advisory mode)` });
      return "changed";
    }
    if (decision.action === "approve") {
      const authority = decision.code === "budget" ? null : await clearWithStandingAuthority(objective, step, ctx, decision.code === "supervised");
      if (authority?.cleared) return { execute: true, polling: false };
      await requestApproval(objective, step, ctx, authority?.missing ? `${decision.reason}\n\nMissing authority: ${authority.missing}` : decision.reason);
      return "changed";
    }
  }
  return { execute: true, polling: false };
}

function deriveStatus(steps: ObjectiveStep[]): ObjectiveStatus {
  const statuses = steps.map((s) => s.status as StepStatus);
  if (statuses.some((s) => s === "running" || s === "retry_wait")) return "running";
  // Pending steps left after a full pass are waiting on dependencies, so an
  // open approval is what the objective is really waiting for.
  if (statuses.some((s) => s === "waiting_approval")) return "waiting_approval";
  if (statuses.some((s) => s === "pending")) return "running";
  if (statuses.every((s) => s === "completed")) return "completed";
  if (statuses.some((s) => s === "failed")) return "failed";
  return "blocked";
}

export function buildReport(objective: Pick<Objective, "title" | "spentCents" | "budgetCents">, steps: ObjectiveStep[]): CompletionReport {
  const item = (s: ObjectiveStep): CompletionReportItem => ({
    key: s.key, title: s.title, role: s.role, status: s.status as StepStatus,
    detail: s.status === "completed" ? `Verified: ${(asRecord(s.verification).checks as { name: string }[] | undefined)?.map((c) => c.name).join("; ") ?? "yes"}` : (s.blockedReason ?? s.error ?? s.status),
    unblockRequest: s.status === "blocked" || s.status === "advised" ? s.unblockRequest : undefined,
  });
  const completed = steps.filter((s) => s.status === "completed").map(item);
  const blocked = steps.filter((s) => s.status === "blocked" || s.status === "advised").map(item);
  const failed = steps.filter((s) => s.status === "failed" || s.status === "cancelled").map(item);
  const pending = steps.filter((s) => !["completed", "blocked", "advised", "failed", "cancelled"].includes(s.status)).map(item);
  return {
    generatedAt: new Date().toISOString(),
    summary: `${objective.title}: ${completed.length}/${steps.length} steps completed and verified, ${blocked.length} blocked, ${failed.length} failed, ${pending.length} pending.`,
    completed, blocked, failed, pending, spentCents: objective.spentCents, budgetCents: objective.budgetCents,
  };
}

/** Advance one objective as far as it can go right now. Caller holds the lease. */
export async function advanceObjective(objectiveId: string, deps: ToolDeps): Promise<ObjectiveStatus> {
  for (let pass = 0; pass < MAX_PASSES; pass += 1) {
    const { objective, steps } = await load(objectiveId);
    if (!ACTIVE_OBJECTIVE_STATUSES.includes(objective.status as ObjectiveStatus)) return objective.status as ObjectiveStatus;
    let changed = false;
    const toExecute: { step: ObjectiveStep; polling: boolean }[] = [];
    for (const step of steps) {
      const outcome = await advanceStep(objective, step, steps, deps, new Date());
      if (outcome === "changed") changed = true;
      else if (outcome !== "unchanged" && outcome.execute) toExecute.push({ step, polling: outcome.polling });
    }
    // Independent ready steps run in parallel, in small batches.
    for (let i = 0; i < toExecute.length; i += STEP_CONCURRENCY) {
      await Promise.all(toExecute.slice(i, i + STEP_CONCURRENCY).map(({ step, polling }) => executeStep(objective, step, steps, deps, polling)));
    }
    const after = await db.objectiveStep.findMany({ where: { objectiveId }, orderBy: { position: "asc" } });
    // Progress means some step moved to a new status; a poll that left an agent run running is not progress.
    const before = new Map(steps.map((s) => [s.id, s.status]));
    const progressed = changed || after.some((s) => s.status !== before.get(s.id));
    const status = deriveStatus(after);
    const current = await db.objective.findUniqueOrThrow({ where: { id: objectiveId } });
    // A pause/stop issued mid-pass wins over anything derived here.
    if (!ACTIVE_OBJECTIVE_STATUSES.includes(current.status as ObjectiveStatus)) return current.status as ObjectiveStatus;
    const settled = status !== "running" && status !== "waiting_approval";
    const report = buildReport(current, after);
    await db.objective.updateMany({
      where: { id: objectiveId, status: { in: [...ACTIVE_OBJECTIVE_STATUSES] } },
      data: { status, report: json(report), ...(settled ? { completedAt: new Date() } : {}) },
    });
    if (status !== current.status) await recordEvent(objectiveId, "objective.status", `Objective is now ${status}. ${report.summary}`);
    if (settled || !progressed) return status;
  }
  return (await db.objective.findUniqueOrThrow({ where: { id: objectiveId }, select: { status: true } })).status as ObjectiveStatus;
}
