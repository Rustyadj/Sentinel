// Routines describe and schedule governed bot tasks. They never execute a bot.
import { Prisma, type Workflow } from "@prisma/client";
import { z } from "zod";
import { db } from "@/lib/db";
import { writeAuditLog } from "@/lib/workspaces/audit";
import { enqueueOrchestrationRun } from "@/lib/orchestration/queue";
import { BotConfigError } from "./models";
import { sha256 } from "./skills";
import { BotTaskError, delegateToBotIn } from "./tasks";

const SNAPSHOT_TYPE = "hermes-routine-snapshot";
const LIVE = ["pending", "queued", "running", "waiting", "cancelling"];
const TERMINAL = ["succeeded", "failed", "cancelled"];
const record = (v: unknown): Record<string, unknown> => v && typeof v === "object" && !Array.isArray(v) ? v as Record<string, unknown> : {};
const json = (v: unknown) => v as Prisma.InputJsonValue;
function fail(message: string, status = 409): never { throw new BotConfigError(message, status); }

export const routineInputSchema = z.object({
  name: z.string().trim().min(1).max(120),
  description: z.string().trim().max(1000).default(""),
  skillId: z.string().min(1).max(100),
  task: z.string().trim().min(1).max(6000),
  context: z.string().trim().max(20_000).default(""),
  // Fixed UTC intervals only; null means manual-only.
  intervalMinutes: z.number().int().min(5).max(525600).nullable().default(null),
}).strict();

async function lockWorkflow(tx: Prisma.TransactionClient, id: string) {
  await tx.$queryRaw`SELECT "id" FROM "workflows" WHERE "id" = ${id} FOR UPDATE`;
  return tx.workflow.findUniqueOrThrow({ where: { id } });
}

// Also used by the unattended scheduler: expired/team role assignments are
// evaluated at dispatch time, rather than treating an old enabling user as admin forever.
async function assertSponsor(userId: string, workspaceId: string) {
  const workspace = await db.workspace.findUnique({ where: { id: workspaceId } });
  if (!workspace?.enabled) fail("Routine workspace is unavailable.", 403);
  if (workspace.ownerId === userId) return;
  const role = await db.roleAssignment.findFirst({ where: {
    workspaceId,
    OR: [{ userId }, { team: { memberUserIds: { has: userId } } }],
    AND: [{ OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }] }],
    role: { OR: [{ name: { equals: "admin", mode: "insensitive" } }, { name: { equals: "owner", mode: "insensitive" } }, { permissions: { some: { key: "*" } } }] },
  } });
  if (!role) fail("The routine sponsor no longer administers this workspace. Enable it again as a current admin.", 403);
}

/** Checkpoint legacy approved Hermes skills on first use, with the original review evidence. */
async function checkpointSkill(tx: Prisma.TransactionClient, skillId: string, workspaceId: string) {
  await tx.$queryRaw`SELECT "id" FROM "neural_skills" WHERE "id" = ${skillId} FOR UPDATE`;
  const skill = await tx.skill.findFirst({ where: { id: skillId, workspaceId, format: "hermes-skill-md", status: "active" } });
  if (!skill?.body || !skill.reviewedAt || !skill.reviewedByUserId) fail("Choose a reviewed, approved Hermes skill.");
  const source = record(skill.source);
  if (source.bodySha256 !== sha256(skill.body) || typeof source.sha256 !== "string") fail("Skill content no longer matches its review. Propose and approve it again.");
  const snapshot = { name: skill.name, body: skill.body, bodySha256: sha256(skill.body), sourceSha256: source.sha256, requiredTools: skill.requiredTools, reviewedByUserId: skill.reviewedByUserId, reviewedAt: skill.reviewedAt.toISOString() };
  const existing = await tx.skillVersion.findUnique({ where: { skillId_version: { skillId, version: skill.version } } });
  if (existing) {
    if (existing.implementationType !== SNAPSHOT_TYPE || record(existing.implementation).bodySha256 !== snapshot.bodySha256) fail("This skill version has different content. Propose and approve a new skill version.");
    return existing;
  }
  return tx.skillVersion.create({ data: { skillId, version: skill.version, implementationType: SNAPSHOT_TYPE, implementation: json(snapshot), status: "active", activatedAt: skill.reviewedAt } });
}

async function pinnedSkill(client: Prisma.TransactionClient, workflow: Workflow) {
  const version = workflow.skillVersionId ? await client.skillVersion.findUnique({ where: { id: workflow.skillVersionId }, include: { skill: true } }) : null;
  if (!version || version.implementationType !== SNAPSHOT_TYPE || version.status !== "active" || version.skill.status !== "active" || version.skill.workspaceId !== workflow.workspaceId) fail("The pinned skill version is unavailable or revoked.");
  const snapshot = record(version.implementation);
  if (typeof snapshot.body !== "string" || snapshot.bodySha256 !== sha256(snapshot.body)) fail("Pinned skill snapshot is invalid.");
  return { version, snapshot };
}

function digest(workflow: Workflow) {
  return sha256(JSON.stringify([workflow.id, workflow.revision, workflow.botId, workflow.workspaceId, workflow.skillVersionId, workflow.name, workflow.description, workflow.routineTask, workflow.routineContext, workflow.intervalMinutes]));
}

function compileTask(workflow: Workflow, snapshot: Record<string, unknown>) {
  const task = `Routine: ${workflow.name}\nWorkflow: ${workflow.id}, revision ${workflow.revision}\nApproved skill version: ${workflow.skillVersionId}\nSkill: ${snapshot.name}\n\nFollow these pinned skill instructions for this task, subject to your bot's policies:\n${snapshot.body}\n\nRoutine task:\n${workflow.routineTask}`;
  if (task.length > 12_000) fail("The skill and task exceed the bot task limit (12,000 characters). Use a shorter approved skill or task.", 400);
  return task;
}

export async function createRoutine(botId: string, raw: unknown, actorUserId: string) {
  const input = routineInputSchema.parse(raw);
  return db.$transaction(async (tx) => {
    const bot = await tx.bot.findUniqueOrThrow({ where: { id: botId } });
    const version = await checkpointSkill(tx, input.skillId, bot.workspaceId);
    const workflow = await tx.workflow.create({ data: {
      name: input.name, description: input.description, kind: "routine", nodes: [], edges: [], status: "proposed",
      workspaceId: bot.workspaceId, botId, userId: actorUserId, skillVersionId: version.id,
      routineTask: input.task, routineContext: input.context, intervalMinutes: input.intervalMinutes,
    } });
    compileTask(workflow, record(version.implementation));
    await audit(workflow, actorUserId, "proposed", {}, tx);
    return workflow;
  });
}

function audit(workflow: Workflow, userId: string, action: string, details: Record<string, unknown> = {}, client: Prisma.TransactionClient = db) {
  return writeAuditLog({ workspaceId: workflow.workspaceId, userId, action: `bot.routine.${action}`, entityType: "Workflow", entityId: workflow.id, details: { revision: workflow.revision, skillVersionId: workflow.skillVersionId, ...details } }, client);
}

export async function editRoutine(id: string, raw: unknown, actorUserId: string, expectedRevision: number) {
  const input = routineInputSchema.parse(raw);
  return db.$transaction(async (tx) => {
    const workflow = await lockWorkflow(tx, id);
    if (workflow.kind !== "routine" || workflow.revision !== expectedRevision) fail("Routine changed. Refresh before editing.");
    const version = await checkpointSkill(tx, input.skillId, workflow.workspaceId!);
    const updated = await tx.workflow.update({ where: { id }, data: {
      name: input.name, description: input.description, routineTask: input.task, routineContext: input.context,
      intervalMinutes: input.intervalMinutes, skillVersionId: version.id, revision: { increment: 1 },
      status: "proposed", reviewedDigest: null, reviewedByUserId: null, reviewedAt: null, nextRunAt: null, runAsUserId: null,
    } });
    compileTask(updated, record(version.implementation));
    await audit(updated, actorUserId, "edited", {}, tx);
    return updated;
  });
}

export async function routineAction(id: string, action: "review" | "enable" | "pause" | "reject", actorUserId: string, reviewedDigest?: string) {
  // Reconcile first so enable sees a genuinely completed test, including continuations.
  await reconcileRoutineRuns(id);
  return db.$transaction(async (tx) => {
    const workflow = await lockWorkflow(tx, id);
    if (workflow.kind !== "routine") fail("Routine not found", 404);
    if (action === "pause" || action === "reject") {
      const updated = await tx.workflow.update({ where: { id }, data: { status: action === "pause" ? "paused" : "rejected", nextRunAt: null, ...(action === "reject" ? { reviewedAt: null, reviewedDigest: null, reviewedByUserId: null } : {}) } });
      await audit(updated, actorUserId, action, {}, tx);
      return updated;
    }
    await pinnedSkill(tx, workflow);
    const currentDigest = digest(workflow);
    if (action === "review") {
      if (reviewedDigest !== currentDigest) fail("Routine changed since review. Read it again before approving.");
      if (workflow.reviewedDigest === currentDigest && workflow.reviewedAt) return workflow;
      const updated = await tx.workflow.update({ where: { id }, data: { status: "reviewed", reviewedDigest: currentDigest, reviewedByUserId: actorUserId, reviewedAt: new Date(), nextRunAt: null } });
      await audit(updated, actorUserId, "reviewed", { digest: currentDigest }, tx);
      return updated;
    }
    if (workflow.reviewedDigest !== currentDigest || !workflow.reviewedAt) fail("Review the current routine revision before enabling.");
    const test = await tx.routineRun.findFirst({ where: { workflowId: id, revision: workflow.revision, trigger: "test", status: "succeeded" } });
    if (!test) fail("Complete a successful test of this revision before enabling.");
    const bot = await tx.bot.findFirst({ where: { id: workflow.botId!, workspaceId: workflow.workspaceId!, status: "active" } });
    if (!bot) fail("Enable the bot before enabling its routine.");
    const updated = await tx.workflow.update({ where: { id }, data: { status: "enabled", runAsUserId: actorUserId, nextRunAt: workflow.status === "enabled" ? workflow.nextRunAt : workflow.intervalMinutes ? new Date(Date.now() + workflow.intervalMinutes * 60_000) : null } });
    await audit(updated, actorUserId, "enabled", {}, tx);
    return updated;
  });
}

/** Durable admission. The workflow lock and partial unique index serialize every trigger. */
export async function requestRoutineRun(id: string, trigger: "manual" | "test" | "schedule", requestKey: string, actorUserId?: string, scheduledFor?: Date) {
  if (!requestKey || requestKey.length > 128) fail("An idempotency key of 1–128 characters is required.", 400);
  await reconcileRoutineRuns(id);
  const run = await db.$transaction(async (tx) => {
    const workflow = await lockWorkflow(tx, id);
    if (workflow.kind !== "routine") fail("Routine not found", 404);
    const key = `${trigger}:${requestKey}`;
    const existing = await tx.routineRun.findUnique({ where: { workflowId_requestKey: { workflowId: id, requestKey: key } } });
    if (existing) return existing;
    if (trigger === "schedule" && (workflow.status !== "enabled" || !workflow.nextRunAt || workflow.nextRunAt.getTime() !== scheduledFor?.getTime())) return null;
    if (trigger !== "test" && (workflow.status !== "enabled" && !(trigger === "manual" && workflow.status === "paused"))) fail("Enable the reviewed and tested routine before running it.");
    if (!workflow.reviewedAt || workflow.reviewedDigest !== digest(workflow)) fail("Review this revision before running it.");
    let compiledTask = "";
    let preparationError: string | null = null;
    try {
      const { snapshot } = await pinnedSkill(tx, workflow);
      compiledTask = compileTask(workflow, snapshot);
    } catch (error) {
      if (trigger !== "schedule" || !(error instanceof BotConfigError)) throw error;
      preparationError = error.message;
    }
    const userId = trigger === "schedule" ? workflow.runAsUserId : actorUserId;
    if (!userId) fail("Routine has no sponsor.");
    const active = await tx.routineRun.findFirst({ where: { workflowId: id, status: { in: LIVE } } });
    const created = await tx.routineRun.create({ data: {
      workflowId: id, revision: workflow.revision, skillVersionId: workflow.skillVersionId!, botId: workflow.botId!, userId,
      trigger, requestKey: key, scheduledFor, status: preparationError ? "failed" : active ? "skipped" : "pending",
      ...(preparationError || active ? { completedAt: new Date(), errorSummary: preparationError ?? "Skipped: a previous routine run is still in flight." } : {}),
      input: json({ task: compiledTask, context: workflow.routineContext ?? "", workspaceId: workflow.workspaceId, mode: "delegate" }),
    } });
    if (trigger === "schedule") {
      // Coalesce missed intervals into one attempt, keeping the original UTC cadence.
      const interval = workflow.intervalMinutes! * 60_000;
      const due = workflow.nextRunAt!.getTime();
      const next = due + (Math.floor(Math.max(0, Date.now() - due) / interval) + 1) * interval;
      await tx.workflow.update({ where: { id }, data: { nextRunAt: new Date(next) } });
    }
    await audit(workflow, userId, "run_requested", { runId: created.id, trigger, status: created.status }, tx);
    return created;
  });
  if (run?.status === "pending") {
    await dispatchRoutineRun(run.id);
    await reconcileRoutineRuns(id);
  }
  return run ? db.routineRun.findUniqueOrThrow({ where: { id: run.id } }) : null;
}

/** Atomically admit with routine history; enqueue only after the DB commit. */
async function dispatchRoutineRun(id: string) {
  const hint = await db.routineRun.findUniqueOrThrow({ where: { id } });
  const admitted = await db.$transaction(async (tx) => {
    const workflow = await lockWorkflow(tx, hint.workflowId);
    await tx.$queryRaw`SELECT "id" FROM "routine_runs" WHERE "id" = ${id} FOR UPDATE`;
    const run = await tx.routineRun.findUniqueOrThrow({ where: { id } });
    if (run.status !== "pending") return null;
    // A committed task awaiting enqueue remains pending and owns its slot.
    if (run.taskId) return tx.orchestrationRun.findUniqueOrThrow({ where: { id: run.taskId } });
    if (workflow.revision !== run.revision || !workflow.reviewedAt || workflow.status === "rejected" || (run.trigger === "schedule" && workflow.status !== "enabled")) {
      await tx.routineRun.update({ where: { id }, data: { status: "cancelled", completedAt: new Date(), errorSummary: "Routine was paused or edited before dispatch." } });
      return null;
    }
    try {
      await pinnedSkill(tx, workflow);
      await assertSponsor(run.userId, workflow.workspaceId!);
      const input = record(run.input);
      // Normal delegation even for a test: no draft/allowedCaller bypass.
      const task = await delegateToBotIn(tx, run.botId, {
        task: String(input.task), context: String(input.context), workspaceId: String(input.workspaceId), idempotencyKey: `routine-${run.id}`,
      }, { kind: "user", userId: run.userId });
      await tx.routineRun.update({ where: { id }, data: { taskId: task.id, currentTaskId: task.id } });
      return task;
    } catch (error) {
      // Expected admission refusals write an outcome. Unexpected DB failures
      // roll the whole transaction back, including any task/event/audit writes.
      if (!(error instanceof BotConfigError) && !(error instanceof BotTaskError)) throw error;
      await tx.routineRun.update({ where: { id }, data: { status: "failed", completedAt: new Date(), errorSummary: error.message.slice(0, 2000) } });
      return null;
    }
  }, { timeout: 60_000, maxWait: 5000 });
  if (!admitted) return;
  try {
    if (admitted.status === "queued") await enqueueOrchestrationRun(admitted.id);
  } catch (error) {
    await db.routineRun.updateMany({ where: { id, status: "pending" }, data: { errorSummary: `Waiting for queue: ${error instanceof Error ? error.message : "Queue unavailable"}`.slice(0, 2000) } });
    return; // The next existing scheduler sweep retries this durable marker.
  }
  // If the worker finished immediately, reconciliation still records its real
  // terminal outcome. A crash before this marker is safe: jobId = task id.
  await db.routineRun.updateMany({ where: { id, status: "pending" }, data: { status: "queued", errorSummary: null } });
}

/** Follow approval continuations and delegated children before releasing a slot. */
export async function reconcileRoutineRuns(workflowId?: string) {
  const runs = await db.routineRun.findMany({ where: { ...(workflowId ? { workflowId } : {}), status: { in: LIVE.filter((s) => s !== "pending") } }, orderBy: { updatedAt: "asc" }, take: 100 });
  for (const run of runs) {
    if (!run.taskId) continue;
    const root = await db.orchestrationRun.findUnique({ where: { id: run.taskId } });
    if (!root) continue; // Fail closed: missing task history cannot free an active slot.
    const tasks = [root];
    let frontier = [root.id];
    while (frontier.length && tasks.length < 1000) {
      const children = await db.orchestrationRun.findMany({ where: { parentRunId: { in: frontier } }, orderBy: { createdAt: "asc" } });
      tasks.push(...children); frontier = children.map((c) => c.id);
    }
    let final = root;
    // Approval continuations keep the routine's exact compiled task.
    while (final.error?.startsWith("Approved and continued as task ")) {
      const next = tasks.find((t) => t.parentRunId === final.id && t.botId === run.botId && record(t.request).task === record(root.request).task);
      if (!next) break;
      final = next;
    }
    const live = tasks.find((t) => !TERMINAL.includes(t.status));
    const status = frontier.length ? "running" : live?.status ?? final.status;
    const completedAt = LIVE.includes(status) ? null : new Date(Math.max(...tasks.map((t) => t.completedAt?.getTime() ?? 0)) || Date.now());
    await db.routineRun.updateMany({ where: { id: run.id, status: { in: LIVE } }, data: {
      currentTaskId: (live ?? final).id, status, startedAt: root.startedAt, completedAt,
      resultSummary: typeof record(final.result).text === "string" ? String(record(final.result).text).slice(0, 2000) : null,
      errorSummary: final.error?.slice(0, 2000) ?? null,
    } });
  }
}

/** Called by the existing recurring/recorded scheduler. DB due times survive restarts. */
export async function sweepRoutines() {
  await reconcileRoutineRuns();
  const pending = await db.routineRun.findMany({ where: { status: "pending" }, take: 50, orderBy: { createdAt: "asc" } });
  const errors: { id: string; error: string }[] = [];
  for (const run of pending) await dispatchRoutineRun(run.id).catch((error: unknown) => { errors.push({ id: run.id, error: error instanceof Error ? error.message : String(error) }); });
  const due = await db.workflow.findMany({ where: { kind: "routine", status: "enabled", nextRunAt: { lte: new Date() } }, orderBy: { nextRunAt: "asc" }, take: 50 });
  for (const workflow of due) {
    // Routines name their bot and workspace without foreign keys. A bot deleted with its workspace (or any way
    // other than deleteBot) would otherwise fail here every interval; pause the routine instead.
    const bot = workflow.botId ? await db.bot.findFirst({ where: { id: workflow.botId, ...(workflow.workspaceId ? { workspaceId: workflow.workspaceId } : {}) }, select: { id: true } }) : null;
    if (!bot) {
      await db.workflow.updateMany({ where: { id: workflow.id, status: "enabled" }, data: { status: "paused", nextRunAt: null } });
      errors.push({ id: workflow.id, error: "The routine's bot or workspace no longer exists; the routine was paused." });
      continue;
    }
    await requestRoutineRun(workflow.id, "schedule", workflow.nextRunAt!.toISOString(), undefined, workflow.nextRunAt!)
      .catch((error: unknown) => { errors.push({ id: workflow.id, error: error instanceof Error ? error.message : String(error) }); });
  }
  return { checked: due.length, recovered: pending.length, errors };
}

export async function listRoutines(botId: string) {
  const rows = await db.workflow.findMany({ where: { kind: "routine", botId }, orderBy: { createdAt: "desc" } });
  for (const row of rows) await reconcileRoutineRuns(row.id);
  return Promise.all(rows.map((row) => getRoutine(row.id)));
}

export async function getRoutine(id: string) {
  const workflow = await db.workflow.findUniqueOrThrow({ where: { id }, include: { skillVersion: true, routineRuns: { orderBy: { createdAt: "desc" }, take: 20 } } });
  return { ...workflow, digest: digest(workflow), skill: workflow.skillVersion ? { id: workflow.skillVersion.skillId, version: workflow.skillVersion.version, ...record(workflow.skillVersion.implementation) } : null };
}
