import { promises as dnsPromises } from "node:dns";
import { randomUUID } from "node:crypto";
import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { writeAuditLog } from "@/lib/workspaces/audit";
import { userHasWorkspacePermission } from "@/lib/workspaces/authorization";
import { createOrchestrationRun } from "@/lib/orchestration/service";
import { cancelOrchestrationRun } from "@/lib/orchestration/executor";
import { assertValidPlan, planObjective, type PlanRequest } from "./planner";
import { recordEvent } from "./engine";
import { parseAutonomyLevel } from "./policy";
import type { ToolDeps } from "./tools";
import { ACTIVE_OBJECTIVE_STATUSES, SETTLED_STEP_STATUSES, type AutonomyLevel, type StepStatus } from "./types";

const json = (value: unknown) => value as Prisma.InputJsonValue;

export class ObjectiveError extends Error {
  constructor(message: string, public readonly status: 400 | 403 | 404 | 409 | 503, public readonly details?: Record<string, unknown>) { super(message); }
}

// --- default engine dependencies (production) -------------------------------------

export function defaultToolDeps(): ToolDeps {
  return {
    fetch: (input, init) => fetch(input, init),
    resolveMx: (domain) => dnsPromises.resolveMx(domain),
    resolveTxt: (domain) => dnsPromises.resolveTxt(domain),
    async dispatchAgentRun({ workspaceId, userId, task, idempotencyKey }) {
      // A crash between dispatch and recording the run id must not dispatch twice.
      const existing = await db.orchestrationRun.findFirst({ where: { userId, request: { path: ["idempotencyKey"], equals: idempotencyKey } }, select: { id: true } });
      if (existing) return existing.id;
      const run = await createOrchestrationRun({ task, workspaceId, idempotencyKey, taskType: "support", mode: "async" }, { userId });
      return run.id;
    },
    async getAgentRun(runId) {
      const run = await db.orchestrationRun.findUnique({ where: { id: runId }, select: { status: true, result: true, error: true, attempts: { select: { cost: true } } } });
      if (!run) return null;
      const text = (run.result as { text?: unknown } | null)?.text;
      // ExecutionAttempt.cost is recorded in USD by the runtimes that report it.
      const cost = run.attempts.reduce((sum, a) => sum + (a.cost ?? 0), 0);
      return { status: run.status, text: typeof text === "string" ? text : null, error: run.error, costCents: Math.round(cost * 100) };
    },
  };
}

// --- authorization ---------------------------------------------------------------

async function requirePermission(userId: string, workspaceId: string, permission: string) {
  if (!(await userHasWorkspacePermission(userId, workspaceId, permission))) throw new ObjectiveError("Objective not found", 404);
}

async function requireObjective(userId: string, objectiveId: string, permission: string) {
  const objective = await db.objective.findUnique({ where: { id: objectiveId } });
  if (!objective) throw new ObjectiveError("Objective not found", 404);
  await requirePermission(userId, objective.workspaceId, permission);
  return objective;
}

// --- create ------------------------------------------------------------------------

export interface CreateObjectiveInput extends PlanRequest {
  workspaceId: string;
  autonomyLevel?: number;
  budgetCents?: number;
}

/** Parse an untrusted request body into CreateObjectiveInput (explicit allowlist). */
export function parseCreateObjectiveBody(body: unknown): CreateObjectiveInput {
  const b = (body && typeof body === "object" ? body : {}) as Record<string, unknown>;
  const str = (v: unknown, max: number) => (typeof v === "string" ? v.slice(0, max) : undefined);
  if (typeof b.workspaceId !== "string" || !b.workspaceId) throw new ObjectiveError("workspaceId is required", 400);
  const goal = str(b.goal, 4000)?.trim();
  if (!goal) throw new ObjectiveError("goal is required", 400);
  const level = b.autonomyLevel === undefined ? 2 : parseAutonomyLevel(b.autonomyLevel);
  if (level === null) throw new ObjectiveError("autonomyLevel must be 1, 2, 3 or 4", 400);
  const budget = b.budgetCents === undefined ? 0 : Number(b.budgetCents);
  if (!Number.isInteger(budget) || budget < 0 || budget > 10_000_000) throw new ObjectiveError("budgetCents must be a non-negative integer", 400);
  const domains = Array.isArray(b.domains) ? b.domains.filter((d): d is string => typeof d === "string").slice(0, 5).map((d) => d.slice(0, 253)) : undefined;
  return { workspaceId: b.workspaceId, goal, autonomyLevel: level, budgetCents: budget, businessName: str(b.businessName, 80), domains, description: str(b.description, 2000) };
}

export async function createObjective(userId: string, input: CreateObjectiveInput) {
  await requirePermission(userId, input.workspaceId, "task.create");
  const planned = planObjective(input);
  if (!planned.ok) {
    throw planned.reason === "missing_inputs"
      ? new ObjectiveError("Some essential details are missing.", 400, { missing: planned.missing })
      : new ObjectiveError(planned.message, 400);
  }
  const plan = planned.plan;
  assertValidPlan(plan);
  const level = (parseAutonomyLevel(input.autonomyLevel) ?? 2) as AutonomyLevel;
  const objective = await db.$transaction(async (tx) => {
    const created = await tx.objective.create({
      data: {
        workspaceId: input.workspaceId, userId, title: plan.title, goal: input.goal, templateKey: plan.templateKey,
        autonomyLevel: level, budgetCents: input.budgetCents ?? 0, inputs: json(plan.inputs), status: "running",
      },
    });
    await tx.objectiveStep.createMany({
      data: plan.steps.map((s, position) => ({
        objectiveId: created.id, key: s.key, position, title: s.title, role: s.role, kind: s.kind, toolKey: s.toolKey, input: json(s.input),
        dependsOn: s.dependsOn, impact: s.impact, maxAttempts: s.maxAttempts ?? 3, estimatedCostCents: s.estimatedCostCents ?? 0,
        idempotencyKey: `obj_${created.id}_${s.key}_${randomUUID()}`,
      })),
    });
    await tx.objectiveEvent.create({ data: { objectiveId: created.id, type: "objective.created", message: `Planned ${plan.steps.length} steps from template ${plan.templateKey} at autonomy level ${level}.`, data: json({ inputs: plan.inputs }) } });
    await writeAuditLog({ workspaceId: input.workspaceId, userId, action: "objective.created", entityType: "objective", entityId: created.id, details: { templateKey: plan.templateKey, autonomyLevel: level, budgetCents: input.budgetCents ?? 0 } }, tx);
    return created;
  });
  return objective;
}

// --- read --------------------------------------------------------------------------

export async function listObjectives(userId: string, workspaceId: string) {
  await requirePermission(userId, workspaceId, "task.read");
  return db.objective.findMany({
    where: { workspaceId }, orderBy: { createdAt: "desc" }, take: 50,
    select: { id: true, title: true, status: true, autonomyLevel: true, budgetCents: true, spentCents: true, createdAt: true, completedAt: true, steps: { select: { status: true } } },
  });
}

export async function getObjective(userId: string, objectiveId: string) {
  const objective = await requireObjective(userId, objectiveId, "task.read");
  const [steps, events] = await Promise.all([
    db.objectiveStep.findMany({ where: { objectiveId }, orderBy: { position: "asc" }, omit: { idempotencyKey: true } }),
    db.objectiveEvent.findMany({ where: { objectiveId }, orderBy: { createdAt: "desc" }, take: 200 }),
  ]);
  const { leaseOwner: _lo, leaseExpiresAt: _le, ...visible } = objective;
  return { objective: visible, steps, events };
}

// --- control -------------------------------------------------------------------------

export type ControlAction = "pause" | "resume" | "stop" | "retry_step";

export async function controlObjective(userId: string, objectiveId: string, action: ControlAction, stepKey?: string) {
  const objective = await requireObjective(userId, objectiveId, "task.update");
  const audit = (details: Record<string, unknown> = {}) => writeAuditLog({ workspaceId: objective.workspaceId, userId, action: `objective.${action}`, entityType: "objective", entityId: objectiveId, details });

  if (action === "pause") {
    const r = await db.objective.updateMany({ where: { id: objectiveId, status: { in: [...ACTIVE_OBJECTIVE_STATUSES] } }, data: { status: "paused" } });
    if (!r.count) throw new ObjectiveError(`Cannot pause an objective that is ${objective.status}.`, 409);
    await recordEvent(objectiveId, "objective.paused", "Paused by operator."); await audit();
    return;
  }
  if (action === "resume") {
    const r = await db.objective.updateMany({ where: { id: objectiveId, status: { in: ["paused", "blocked", "failed"] } }, data: { status: "running", completedAt: null } });
    if (!r.count) throw new ObjectiveError(`Cannot resume an objective that is ${objective.status}.`, 409);
    await recordEvent(objectiveId, "objective.resumed", "Resumed by operator."); await audit();
    return;
  }
  if (action === "stop") {
    await stopObjective(objectiveId, userId, "Stopped by operator.");
    await audit();
    return;
  }
  if (action === "retry_step") {
    if (objective.status === "stopped") throw new ObjectiveError("A stopped objective cannot be retried.", 409);
    const step = await db.objectiveStep.findFirst({ where: { objectiveId, key: stepKey ?? "" } });
    if (!step) throw new ObjectiveError("Step not found", 404);
    if (!["blocked", "failed", "advised", "cancelled"].includes(step.status)) throw new ObjectiveError(`Step is ${step.status}; only blocked, failed, advised or cancelled steps can be retried.`, 409);
    // A retry is a fresh execution: any spent approval does not carry over.
    await db.objectiveStep.update({ where: { id: step.id }, data: { status: "pending", attempts: 0, error: null, blockedReason: null, unblockRequest: null, nextAttemptAt: null, approvalRequestId: null, approvalClearedAt: null, orchestrationRunId: null } });
    // Steps that were only blocked because of this one become pending again.
    await db.objectiveStep.updateMany({ where: { objectiveId, status: "blocked", blockedReason: { startsWith: "dependency:" } }, data: { status: "pending", blockedReason: null, unblockRequest: null } });
    await db.objective.update({ where: { id: objectiveId }, data: { status: "running", completedAt: null } });
    await recordEvent(objectiveId, "step.retry_requested", `Operator requested a retry of ${step.title}.`, step.key); await audit({ stepKey });
    return;
  }
  throw new ObjectiveError("Unknown action", 400);
}

/** Stop one objective: no further steps start, in-flight agent runs are cancelled. */
export async function stopObjective(objectiveId: string, userId: string, reason: string) {
  await db.objective.updateMany({ where: { id: objectiveId, status: { notIn: ["completed", "stopped"] } }, data: { status: "stopped", stopReason: reason, stoppedAt: new Date() } });
  const live = await db.objectiveStep.findMany({ where: { objectiveId, status: { notIn: [...SETTLED_STEP_STATUSES] as StepStatus[] } } });
  for (const step of live) {
    if (step.orchestrationRunId) await cancelOrchestrationRun(step.orchestrationRunId, userId).catch(() => null);
    if (step.approvalRequestId && step.status === "waiting_approval") {
      await db.approvalRequest.updateMany({ where: { id: step.approvalRequestId, status: "pending" }, data: { status: "cancelled", decisionNote: reason, decidedAt: new Date() } });
    }
  }
  await db.objectiveStep.updateMany({ where: { objectiveId, status: { notIn: [...SETTLED_STEP_STATUSES] as StepStatus[] } }, data: { status: "cancelled", error: reason } });
  await recordEvent(objectiveId, "objective.stopped", reason);
}

/** Emergency stop for a whole workspace. Requires the same permission as reviewing approvals. */
export async function emergencyStopWorkspace(userId: string, workspaceId: string): Promise<number> {
  await requirePermission(userId, workspaceId, "approval.review");
  const active = await db.objective.findMany({ where: { workspaceId, status: { in: [...ACTIVE_OBJECTIVE_STATUSES, "paused"] } }, select: { id: true } });
  for (const { id } of active) await stopObjective(id, userId, "Emergency stop issued for the workspace.");
  await writeAuditLog({ workspaceId, userId, action: "objective.emergency_stop", entityType: "workspace", entityId: workspaceId, details: { stopped: active.length } });
  return active.length;
}
