// Delegating work to a bot, and reading it back. A bot task IS an
// OrchestrationRun (botId set): it is queued on the existing BullMQ queue,
// executed by the existing worker, cancelled by the existing lease-aware path.
// Nothing here pretends to run anything — a task is QUEUED until a worker
// really claims it.

import type { OrchestrationRun, Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { getRuntimeView } from "@/lib/agents/runtime/service";
import { resolveMcpContext } from "@/lib/integrations/mcp-context";
import { readableWorkspaceIds } from "@/lib/knowledge/memory-scope";
import { cancelOrchestrationRun } from "@/lib/orchestration/executor";
import { enqueueOrchestrationRun } from "@/lib/orchestration/queue";
import { writeAuditLog } from "@/lib/workspaces/audit";
import { ApprovalAlreadyDecidedError, decideApprovalIn } from "@/lib/workspaces/approvals";
import { BotRunLog } from "./events";
import { activeCatalog, loadCatalog } from "./catalog";
import { approvalKey, evaluateDelegation, resolveObservedTool, type DelegationParent } from "./policy";
import { toBotRecord, type BotRecord } from "./service";
import { delegateTaskSchema, toBotTaskStatus, type BotTaskStatus, type DelegateTaskInput } from "./schema";

export class BotTaskError extends Error {
  constructor(message: string, readonly status = 400) { super(message); this.name = "BotTaskError"; }
}

export type BotCaller =
  | { kind: "user"; userId: string }
  | { kind: "agent"; userId: string; agentId: string }
  | { kind: "client"; userId: string; clientId: string }
  | { kind: "bot"; userId: string; botId: string };

export const callerKey = (caller: BotCaller): string => {
  switch (caller.kind) {
    case "user": return `user:${caller.userId}`;
    case "agent": return `agent:${caller.agentId}`;
    case "client": return `client:${caller.clientId}`;
    case "bot": return `bot:${caller.botId}`;
  }
};

const startOfUtcDay = () => { const now = new Date(); return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())); };

export interface UsageTotals { tokens: number; costUsd: number; pricedTasks: number; tasks: number }

/** Tokens and cost the bot's tasks reported since UTC midnight. Cost counts only priced models. */
export async function botUsageToday(botId: string): Promise<UsageTotals> {
  const attempts = await db.executionAttempt.findMany({
    where: { orchestrationRun: { botId, createdAt: { gte: startOfUtcDay() } } },
    select: { usage: true, cost: true },
  });
  let tokens = 0; let costUsd = 0; let pricedTasks = 0;
  for (const attempt of attempts) {
    const usage = attempt.usage as { totalTokens?: number } | null;
    tokens += typeof usage?.totalTokens === "number" ? usage.totalTokens : 0;
    if (typeof attempt.cost === "number") { costUsd += attempt.cost; pricedTasks += 1; }
  }
  return { tokens, costUsd, pricedTasks, tasks: attempts.length };
}

async function assertUserCanReachBot(userId: string, workspaceId: string): Promise<void> {
  // Not-found rather than forbidden: a user outside the workspace learns nothing about its bots.
  if (!(await readableWorkspaceIds(userId)).includes(workspaceId)) throw new BotTaskError("Bot not found", 404);
}

/** Chain of bot ids from the root task down to (and including) `run`. */
async function delegationChain(run: OrchestrationRun): Promise<string[]> {
  const chain: string[] = [];
  let current: OrchestrationRun | null = run;
  for (let hops = 0; current && hops < 10; hops += 1) {
    if (current.botId) chain.unshift(current.botId);
    current = current.parentRunId ? await db.orchestrationRun.findUnique({ where: { id: current.parentRunId } }) : null;
  }
  return chain;
}

export interface DelegateOptions {
  /** "test" is an admin exercising the bot: allowed for draft/disabled bots and not gated by allowedCallers. */
  mode?: "delegate" | "test";
  /** Canonical tool keys the requester has already approved for this task. Only set by resume. */
  approvedTools?: string[];
  /** Continue an already-authorised task as this caller (an approval resume) instead of the requester. */
  originKey?: string;
}

/** One one-use tool permission handed to a new task. `sourceRunId` marks an unspent grant carried forward from the parent. */
export interface GrantSpec { key: string; approvalRequestId?: string; sourceRunId?: string }

interface AdmittedTask {
  bot: BotRecord;
  input: DelegateTaskInput;
  mode: "delegate" | "test";
  key: string;
  projectId: string | null;
  parentRun: OrchestrationRun | null;
  caller: BotCaller;
}

/**
 * Everything that decides whether a task may exist: caller identity, delegation
 * policy, scope, host health, limits, idempotency. It reads and refuses; it writes
 * nothing. Splitting it from the insert lets an approval continuation run these
 * checks BEFORE it commits to a decision, and then create the task inside the
 * decision's own transaction.
 */
async function admitTask(botId: string, rawInput: DelegateTaskInput, caller: BotCaller, options: DelegateOptions): Promise<{ existingId: string } | { admitted: AdmittedTask }> {
  const parsed = delegateTaskSchema.safeParse(rawInput);
  if (!parsed.success) throw new BotTaskError(parsed.error.issues.map((issue) => `${issue.path.join(".") || "input"}: ${issue.message}`).join("; "));
  const input = parsed.data;
  const mode = options.mode ?? "delegate";

  const row = await db.bot.findUnique({ where: { id: botId } });
  if (!row) throw new BotTaskError("Bot not found", 404);
  await assertUserCanReachBot(caller.userId, row.workspaceId);
  const bot = toBotRecord(row);

  // --- who may ask ---------------------------------------------------------
  // The caller key is always the authenticated caller. A `parentTaskId` is only a
  // claim about lineage: it lets a bot that is executing a task delegate on that
  // task's behalf, and it is honoured solely when the authenticated caller IS
  // that bot. Anyone else naming a parent task (a user, an MCP client, an agent,
  // a different bot) is refused rather than silently demoted, so a client can
  // never borrow a running bot's identity or its allowedChildBots.
  let parent: DelegationParent | null = null;
  let parentRun: OrchestrationRun | null = null;
  if (input.parentTaskId) {
    if (caller.kind !== "bot") throw new BotTaskError("parentTaskId can only be supplied by the bot that is executing that task.", 403);
    parentRun = await db.orchestrationRun.findFirst({ where: { id: input.parentTaskId, userId: caller.userId, botId: { not: null } } });
    if (!parentRun || !["running", "waiting"].includes(parentRun.status)) throw new BotTaskError("Parent task not found or not running", 404);
    if (parentRun.botId !== caller.botId) throw new BotTaskError("parentTaskId can only be supplied by the bot that is executing that task.", 403);
    const parentBotRow = await db.bot.findUnique({ where: { id: parentRun.botId! } });
    if (!parentBotRow) throw new BotTaskError("Parent bot no longer exists", 404);
    parent = { bot: { id: parentBotRow.id, status: parentBotRow.status, delegationPolicy: toBotRecord(parentBotRow).delegationPolicy }, chain: await delegationChain(parentRun) };
  }
  const key = options.originKey ?? callerKey(caller);
  if (mode === "delegate") {
    const decision = evaluateDelegation({ target: { id: bot.id, status: bot.status, delegationPolicy: bot.delegationPolicy }, callerKey: key, parent });
    if (!decision.allowed) throw new BotTaskError(decision.reason, 403);
  }

  // --- scope: a bot only works inside its own workspace ---------------------
  if (input.workspaceId && input.workspaceId !== bot.workspaceId) throw new BotTaskError("That workspace is not the bot's workspace.", 403);
  let projectId: string | null = null;
  if (input.projectId) {
    const resolved = await resolveMcpContext(caller.userId, { projectId: input.projectId });
    if (!resolved.scope.projectId) throw new BotTaskError("Project not found", 404);
    if (resolved.scope.workspaceId !== bot.workspaceId) throw new BotTaskError("That project is outside the bot's workspace.", 403);
    projectId = resolved.scope.projectId;
  }

  // --- host must be able to execute; limits must have headroom --------------
  const host = await getRuntimeView(bot.runtimeAgentId);
  if (!host || !host.enabled) throw new BotTaskError(`Host runtime ${bot.runtimeAgentId} is not available.`, 503);
  if (!host.executionVerified) throw new BotTaskError(`Host runtime ${bot.runtimeAgentId} has no verified execution contract.`, 503);

  const inFlight = await db.orchestrationRun.count({ where: { botId: bot.id, status: { in: ["queued", "running", "cancelling"] } } });
  if (inFlight >= bot.limits.maxConcurrentTasks) throw new BotTaskError(`${bot.name} is at its concurrency limit (${bot.limits.maxConcurrentTasks}). Try again when a task finishes.`, 429);
  if (bot.limits.maxTokensPerDay || bot.limits.maxCostPerDay) {
    const used = await botUsageToday(bot.id);
    if (bot.limits.maxTokensPerDay && used.tokens >= bot.limits.maxTokensPerDay) throw new BotTaskError(`${bot.name} has used its daily token budget (${used.tokens}/${bot.limits.maxTokensPerDay}).`, 429);
    if (bot.limits.maxCostPerDay && used.costUsd >= bot.limits.maxCostPerDay) throw new BotTaskError(`${bot.name} has used its daily cost budget.`, 429);
  }

  if (input.idempotencyKey) {
    const existing = await db.orchestrationRun.findFirst({ where: { botId: bot.id, originKey: key, idempotencyKey: input.idempotencyKey } });
    if (existing) return { existingId: existing.id };
  }
  return { admitted: { bot, input, mode, key, projectId, parentRun, caller } };
}

/** Insert the task row and its one-use grants through `client` (the decision's transaction, for a continuation). */
async function insertTaskRun(client: Prisma.TransactionClient, task: AdmittedTask, grants: readonly GrantSpec[], parentRunId?: string) {
  const { bot, input, mode, key, projectId, parentRun, caller } = task;
  const unique = [...new Map(grants.map((grant) => [grant.key, grant])).values()];
  const run = await client.orchestrationRun.create({
    data: {
      userId: caller.userId, workspaceId: bot.workspaceId, projectId, botId: bot.id, originKey: key,
      parentRunId: parentRunId ?? parentRun?.id ?? null, idempotencyKey: input.idempotencyKey ?? null,
      request: {
        task: input.task, context: input.context ?? null, modelRole: input.modelRole, mode, botName: bot.name,
        // A record of what was issued. The authority is the BotToolGrant rows: they are what gets spent, and what a continuation inherits.
        ...(unique.length ? { approvedTools: unique.map((grant) => grant.key), grantsVersion: 2 } : {}),
      } as Prisma.InputJsonValue,
      requestedAgentId: bot.runtimeAgentId, resolvedAgentId: bot.runtimeAgentId,
      routingDecision: { kind: "bot", botId: bot.id, host: bot.runtimeAgentId, reason: `Delegated to bot ${bot.name}.` } as Prisma.InputJsonValue,
      contextSnapshot: { scope: { workspaceId: bot.workspaceId, projectId } } as Prisma.InputJsonValue,
    },
  });
  if (unique.length) {
    await client.botToolGrant.createMany({ data: unique.map((grant) => ({ runId: run.id, key: grant.key, approvalRequestId: grant.approvalRequestId ?? null, sourceRunId: grant.sourceRunId ?? null })) });
  }
  return run;
}

async function recordQueued(run: OrchestrationRun, task: AdmittedTask): Promise<void> {
  const { bot, key, mode, input, parentRun, caller } = task;
  await new BotRunLog(bot.id, run.id).emit("queued", `Task queued by ${key}.`, { caller: key, mode, modelRole: input.modelRole });
  if (parentRun?.botId) await new BotRunLog(parentRun.botId, parentRun.id).emit("delegated", `Delegated to ${bot.name}.`, { childTaskId: run.id, childBotId: bot.id });
  await writeAuditLog({
    workspaceId: bot.workspaceId, projectId: run.projectId, userId: caller.userId, actorType: caller.kind === "user" ? "user" : "agent",
    agentId: caller.kind === "agent" ? caller.agentId : null, action: "bot.task.queued", entityType: "orchestration_run", entityId: run.id,
    details: { botId: bot.id, caller: key, mode },
  });
}

export async function delegateToBot(botId: string, rawInput: DelegateTaskInput, caller: BotCaller, options: DelegateOptions = {}) {
  const admission = await admitTask(botId, rawInput, caller, options);
  if ("existingId" in admission) return getBotTask(admission.existingId, { userId: caller.userId, isAdmin: false });
  const { admitted } = admission;
  const run = await insertTaskRun(db, admitted, (options.approvedTools ?? []).map((key) => ({ key })));
  await recordQueued(run, admitted);
  try {
    await enqueueOrchestrationRun(run.id);
  } catch (error) {
    // The run row exists but nothing will ever pick it up. Say so, rather than leaving a task that reads QUEUED forever.
    const message = error instanceof Error ? error.message : "Queue unavailable";
    await db.orchestrationRun.update({ where: { id: run.id }, data: { status: "failed", error: `Could not be queued: ${message}`, completedAt: new Date() } });
    await new BotRunLog(admitted.bot.id, run.id).emit("error", `Could not be queued: ${message}`);
    throw new BotTaskError(`The task could not be queued: ${message}`, 503);
  }
  return getBotTask(run.id, { userId: caller.userId, isAdmin: false });
}

// ---------------------------------------------------------------- views ----

export interface BotTaskEvent { seq: number; type: string; summary: string; data: Record<string, unknown>; at: string }
export interface BotTaskView {
  id: string;
  botId: string | null;
  botName: string | null;
  status: BotTaskStatus;
  rawStatus: string;
  mode: string;
  origin: string | null;
  parentTaskId: string | null;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  durationMs: number | null;
  input: { task: string | null; context: string | null };
  output: { text: string } | null;
  artifacts: { id: string; type: string; title: string; url: string | null; mimeType: string | null }[];
  toolCalls: { tool: string; server: string | null; decision: "allowed" | "denied" | "approval"; reason: string; at: string }[];
  memory: { read: { retrieved: number; injected: number; dropped: number; scopes: string[]; skipped: string | null } | null; writes: { scope: string | null; accepted: boolean; denied: string | null }[] };
  model: { requested: string | null; actual: string | null; provider: string | null };
  usage: { inputTokens: number | null; outputTokens: number | null; totalTokens: number | null } | null;
  cost: { usd: number | null; note: string };
  error: string | null;
  cancelRequested: boolean;
  waitingFor: { approvalRequestId: string; tool: string } | null;
  events: BotTaskEvent[];
}

export interface TaskViewer { userId: string; isAdmin: boolean }

const asRecord = (value: unknown): Record<string, unknown> => (value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {});
const num = (value: unknown): number | null => (typeof value === "number" && Number.isFinite(value) ? value : null);

export async function getBotTask(taskId: string, viewer: TaskViewer): Promise<BotTaskView> {
  const run = await db.orchestrationRun.findFirst({
    where: { id: taskId, botId: { not: null }, ...(viewer.isAdmin ? {} : { userId: viewer.userId }) },
    include: { attempts: { orderBy: { attemptNumber: "desc" }, take: 1 }, artifacts: true },
  });
  if (!run || !run.botId) throw new BotTaskError("Task not found", 404);
  // Re-checked on every read: a user removed from the workspace after delegating
  // can no longer read the task, the same fail-closed rule the MCP task tools use.
  if (!viewer.isAdmin && (!run.workspaceId || !(await readableWorkspaceIds(viewer.userId)).includes(run.workspaceId))) throw new BotTaskError("Task not found", 404);
  const [bot, eventRows] = await Promise.all([
    db.bot.findUnique({ where: { id: run.botId }, select: { name: true } }),
    db.botRunEvent.findMany({ where: { runId: run.id }, orderBy: { seq: "asc" }, take: 500 }),
  ]);
  const events: BotTaskEvent[] = eventRows.map((event) => ({ seq: event.seq, type: event.type, summary: event.summary, data: asRecord(event.data), at: event.occurredAt.toISOString() }));
  const attempt = run.attempts[0] ?? null;
  const request = asRecord(run.request);
  const result = asRecord(run.result);
  const usageRaw = asRecord(attempt?.usage);
  const modelEvent = events.find((event) => event.type === "model");
  const usageEvent = [...events].reverse().find((event) => event.type === "usage");
  const memRead = events.find((event) => event.type === "memory_read");
  const waiting = [...events].reverse().find((event) => event.type === "approval_requested");
  const model = asRecord(modelEvent?.data);
  const started = run.startedAt?.getTime();
  const finished = run.completedAt?.getTime();

  return {
    id: run.id, botId: run.botId, botName: bot?.name ?? (typeof request.botName === "string" ? request.botName : null),
    status: toBotTaskStatus(run.status), rawStatus: run.status, mode: typeof request.mode === "string" ? request.mode : "delegate",
    origin: run.originKey, parentTaskId: run.parentRunId,
    createdAt: run.createdAt.toISOString(), startedAt: run.startedAt?.toISOString() ?? null, finishedAt: run.completedAt?.toISOString() ?? null,
    durationMs: started && finished ? finished - started : null,
    input: { task: typeof request.task === "string" ? request.task : null, context: typeof request.context === "string" ? request.context : null },
    output: typeof result.text === "string" ? { text: result.text } : null,
    artifacts: run.artifacts.map((artifact) => ({ id: artifact.id, type: artifact.type, title: artifact.title, url: artifact.storageUrl, mimeType: artifact.mimeType })),
    toolCalls: events.filter((event) => ["tool_allowed", "tool_denied", "approval_requested"].includes(event.type)).map((event) => ({
      tool: String(event.data.tool ?? "unknown"), server: typeof event.data.server === "string" ? event.data.server : null,
      decision: event.type === "tool_allowed" ? "allowed" : event.type === "approval_requested" ? "approval" : "denied",
      reason: String(event.data.reason ?? event.summary), at: event.at,
    })),
    memory: {
      read: memRead ? { retrieved: num(memRead.data.retrieved) ?? 0, injected: num(memRead.data.injected) ?? 0, dropped: num(memRead.data.dropped) ?? 0, scopes: Array.isArray(memRead.data.scopes) ? memRead.data.scopes.map(String) : [], skipped: typeof memRead.data.skipped === "string" ? memRead.data.skipped : null } : null,
      writes: events.filter((event) => event.type === "memory_write").map((event) => ({ scope: typeof event.data.scope === "string" ? event.data.scope : null, accepted: event.data.accepted === true, denied: typeof event.data.denied === "string" ? event.data.denied : null })),
    },
    model: {
      requested: typeof model.requested === "string" ? model.requested : attempt?.model ?? null,
      actual: typeof model.actual === "string" ? model.actual : typeof usageEvent?.data.model === "string" ? usageEvent.data.model : null,
      provider: typeof model.provider === "string" ? model.provider : null,
    },
    usage: attempt && Object.keys(usageRaw).length ? { inputTokens: num(usageRaw.inputTokens), outputTokens: num(usageRaw.outputTokens), totalTokens: num(usageRaw.totalTokens) } : null,
    cost: typeof attempt?.cost === "number" ? { usd: attempt.cost, note: "Calculated from reported tokens at Sentinel's rate card." } : { usd: null, note: "Not priced: Sentinel has no rate for this model, so no cost is shown." },
    error: run.error, cancelRequested: run.status === "cancelling",
    waitingFor: run.status === "waiting" && waiting ? { approvalRequestId: String(waiting.data.approvalRequestId ?? ""), tool: String(waiting.data.tool ?? "") } : null,
    events,
  };
}

export async function listBotTasks(botId: string, viewer: TaskViewer, limit = 30) {
  const runs = await db.orchestrationRun.findMany({
    where: { botId, ...(viewer.isAdmin ? {} : { userId: viewer.userId }) },
    orderBy: { createdAt: "desc" }, take: Math.min(Math.max(limit, 1), 100),
    include: { attempts: { orderBy: { attemptNumber: "desc" }, take: 1, select: { model: true, usage: true, cost: true, latencyMs: true } } },
  });
  return runs.map((run) => {
    const request = asRecord(run.request);
    const usage = asRecord(run.attempts[0]?.usage);
    return {
      id: run.id, status: toBotTaskStatus(run.status), mode: typeof request.mode === "string" ? request.mode : "delegate", origin: run.originKey,
      task: typeof request.task === "string" ? request.task.slice(0, 160) : null,
      createdAt: run.createdAt.toISOString(), startedAt: run.startedAt?.toISOString() ?? null, finishedAt: run.completedAt?.toISOString() ?? null,
      model: run.attempts[0]?.model ?? null, totalTokens: num(usage.totalTokens), costUsd: run.attempts[0]?.cost ?? null, latencyMs: run.attempts[0]?.latencyMs ?? null, error: run.error,
    };
  });
}

// --------------------------------------------------------------- control ----

export async function cancelBotTask(taskId: string, viewer: TaskViewer) {
  const run = await db.orchestrationRun.findFirst({ where: { id: taskId, botId: { not: null }, ...(viewer.isAdmin ? {} : { userId: viewer.userId }) } });
  if (!run || !run.botId) throw new BotTaskError("Task not found", 404);
  if (run.status === "waiting") {
    // Conditional on `waiting`: an approval that won the race has already closed this task and queued its continuation.
    const closed = await db.$transaction(async (tx) => {
      const won = await tx.orchestrationRun.updateMany({ where: { id: run.id, status: "waiting" }, data: { status: "cancelled", completedAt: new Date() } });
      if (won.count === 0) return false;
      await tx.approvalRequest.updateMany({ where: { status: "pending", payload: { path: ["runId"], equals: run.id } }, data: { status: "rejected", decidedAt: new Date(), decisionNote: "Task was cancelled." } });
      return true;
    });
    if (!closed) throw new BotTaskError("Task cannot be cancelled (its approval was just decided).", 409);
    await new BotRunLog(run.botId, run.id).emit("cancelled", "Cancelled while waiting for approval.");
    return { taskId, status: "cancelled" as const, acknowledged: true };
  }
  const cancellation = await cancelOrchestrationRun(run.id, run.userId);
  if (!cancellation) throw new BotTaskError("Task cannot be cancelled (already finished, or being cancelled).", 409);
  await writeAuditLog({ workspaceId: run.workspaceId, userId: viewer.userId, action: "bot.task.cancel_requested", entityType: "orchestration_run", entityId: run.id, details: { botId: run.botId } });
  await new BotRunLog(run.botId, run.id).emit("cancelled", cancellation.status === "cancelled" ? "Cancelled before it started." : "Cancellation requested; waiting for the runtime to confirm.", { status: cancellation.status });
  return { taskId, status: cancellation.status, acknowledged: cancellation.status === "cancelled" };
}

/**
 * The canonical `<serverId>:<catalog tool>` keys an approval grants, checked against the
 * workspace's live catalog. New approvals carry them; a key the catalog no longer has
 * (server removed or disabled since) grants nothing, so the reviewer is told rather than
 * handed an approval that can never match. An approval created before canonical names
 * (or by hand) only has the name the runtime reported: it is resolved against the catalog
 * now, and refused when that is ambiguous, because guessing which of two servers' tools
 * was meant would grant the wrong one.
 */
async function approvedKeysFor(payload: Record<string, unknown>, workspaceId: string | null): Promise<string[]> {
  if (!workspaceId) throw new BotTaskError("This approval has no workspace, so its tool cannot be resolved.", 409);
  const catalog = activeCatalog(await loadCatalog(workspaceId));
  const known = new Set(catalog.flatMap((server) => server.tools.map((tool) => approvalKey(server.id, tool.name))));
  if (Array.isArray(payload.approvalKeys) && payload.approvalKeys.length) {
    const keys = [...new Set(payload.approvalKeys.map(String))].filter((key) => known.has(key));
    if (!keys.length) throw new BotTaskError("The tool this approval covers is no longer available. Deny it and run the task again.", 409);
    return keys;
  }
  const tool = String(payload.tool ?? "");
  const serverId = typeof payload.serverId === "string" ? payload.serverId : null;
  const resolved = resolveObservedTool(tool, catalog).filter((candidate) => !serverId || candidate.serverId === serverId);
  if (resolved.length === 1) return [approvalKey(resolved[0].serverId, resolved[0].toolName)];
  throw new BotTaskError(resolved.length ? "This approval names a tool that more than one server exposes, so it cannot be resolved safely. Deny it and run the task again." : "This approval does not name a tool in the catalog. Deny it and run the task again.", 409);
}

/** A lost race on the approval or on the waiting task is a conflict. Anything else is a real failure and is not disguised as one. */
const asConflict = (error: unknown): never => {
  if (error instanceof ApprovalAlreadyDecidedError) throw new BotTaskError("This approval was already decided", 409);
  throw error;
};

interface ContinuationMarker { runId: string; pendingEnqueue: boolean; enqueuedAt?: string; error?: string }
const continuationOf = (payload: Record<string, unknown>): ContinuationMarker | null => {
  const marker = asRecord(payload.continuation);
  return typeof marker.runId === "string" ? { runId: marker.runId, pendingEnqueue: marker.pendingEnqueue === true, ...(typeof marker.error === "string" ? { error: marker.error } : {}) } : null;
};

async function writeMarker(approvalId: string, marker: ContinuationMarker): Promise<void> {
  const current = await db.approvalRequest.findUnique({ where: { id: approvalId }, select: { payload: true } });
  if (!current) return;
  await db.approvalRequest.update({ where: { id: approvalId }, data: { payload: { ...asRecord(current.payload), continuation: marker } as unknown as Prisma.InputJsonValue } });
}

/**
 * Put an already-committed continuation on the queue. The decision and the child row are durable
 * before this runs; if the queue is down the child simply stays `queued` and the approval keeps
 * `continuation.pendingEnqueue`, which retryBotContinuations (run by the worker, and on a repeat
 * approve) picks up. Nothing here can start work: only a job on the queue does, and BullMQ's
 * jobId = run id makes a repeated add a no-op.
 */
async function enqueueContinuation(approvalId: string, runId: string): Promise<{ enqueued: boolean; error?: string }> {
  try {
    await enqueueOrchestrationRun(runId);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Queue unavailable";
    await writeMarker(approvalId, { runId, pendingEnqueue: true, error: message }).catch(() => undefined);
    return { enqueued: false, error: message };
  }
  await writeMarker(approvalId, { runId, pendingEnqueue: false, enqueuedAt: new Date().toISOString() }).catch(() => undefined);
  return { enqueued: true };
}

/**
 * Enqueue approved continuations whose first enqueue failed. A continuation whose task has since
 * been cancelled or finished is settled without enqueuing. Safe to call concurrently and repeatedly.
 */
export async function retryBotContinuations(options: { limit?: number; approvalId?: string } = {}): Promise<{ checked: number; enqueued: number; settled: number; failed: number }> {
  const approvals = await db.approvalRequest.findMany({
    where: { type: "bot_tool_call", status: "approved", ...(options.approvalId ? { id: options.approvalId } : {}), payload: { path: ["continuation", "pendingEnqueue"], equals: true } },
    take: options.limit ?? 20, orderBy: { decidedAt: "asc" },
  });
  const totals = { checked: approvals.length, enqueued: 0, settled: 0, failed: 0 };
  for (const approval of approvals) {
    const marker = continuationOf(asRecord(approval.payload));
    if (!marker) continue;
    const child = await db.orchestrationRun.findUnique({ where: { id: marker.runId }, select: { id: true, status: true, botId: true } });
    if (!child || child.status !== "queued") {
      await writeMarker(approval.id, { runId: marker.runId, pendingEnqueue: false, error: child ? `Not enqueued: task is ${child.status}.` : "Not enqueued: task no longer exists." });
      totals.settled += 1;
      continue;
    }
    const outcome = await enqueueContinuation(approval.id, child.id);
    if (outcome.enqueued) {
      totals.enqueued += 1;
      if (child.botId) await new BotRunLog(child.botId, child.id).emit("queued", "Continuation queued after an earlier queue failure.").catch(() => undefined);
    } else totals.failed += 1;
  }
  return totals;
}

/**
 * Resolve the approval a WAITING task stopped for. Approving starts a NEW task
 * (a child of the waiting one) that may use that one tool; the waiting task is
 * closed, because a runtime session that has been interrupted cannot be resumed
 * safely. Denying simply closes it.
 *
 * Atomicity. The decision, the closing of the waiting task, and the creation of the
 * continuation are ONE transaction, each guarded by a conditional update:
 *  - the approval flips only from `pending` and the task only from `waiting`, so of any
 *    number of simultaneous decisions exactly one wins and the rest roll back, creating nothing;
 *  - the continuation row is committed together with the approval, so a continuation can never
 *    exist for an approval that was not approved, and an approval is never approved without one;
 *  - the continuation is enqueued only after that commit, so a worker cannot pick it up while
 *    the decision is still pending. If the enqueue fails the child stays `queued` with a durable
 *    `pendingEnqueue` marker and is retried; it never runs unqueued and the approval is not stranded.
 */
export async function resolveBotTaskApproval(
  taskId: string,
  decision: "approve" | "deny",
  viewer: TaskViewer & { isAdmin: true },
  options: { decisionNote?: string } = {},
) {
  const run = await db.orchestrationRun.findFirst({ where: { id: taskId, botId: { not: null }, status: "waiting" } });
  if (!run || !run.botId) {
    // An approve that already committed but could not be queued: repeating it re-queues, rather than reporting "not waiting".
    if (decision === "approve") {
      const decided = await db.approvalRequest.findFirst({ where: { type: "bot_tool_call", status: "approved", payload: { path: ["runId"], equals: taskId } } });
      const marker = decided ? continuationOf(asRecord(decided.payload)) : null;
      if (decided && marker?.pendingEnqueue) {
        await retryBotContinuations({ approvalId: decided.id });
        const after = continuationOf(asRecord((await db.approvalRequest.findUniqueOrThrow({ where: { id: decided.id } })).payload));
        return { status: "resumed" as const, resumedTaskId: marker.runId, enqueued: after?.pendingEnqueue === false };
      }
    }
    throw new BotTaskError("Task is not waiting for approval", 404);
  }
  const approval = await db.approvalRequest.findFirst({ where: { status: "pending", type: "bot_tool_call", ...(run.workspaceId ? { workspaceId: run.workspaceId } : {}), payload: { path: ["runId"], equals: run.id } } });
  if (!approval) throw new BotTaskError("No pending approval for this task", 404);
  const payload = asRecord(approval.payload);
  const log = new BotRunLog(run.botId, run.id);

  if (decision === "deny") {
    try {
      await db.$transaction(async (tx) => {
        await decideApprovalIn(tx, approval.id, "rejected", viewer.userId, options.decisionNote);
        const closed = await tx.orchestrationRun.updateMany({ where: { id: run.id, status: "waiting" }, data: { status: "cancelled", completedAt: new Date(), error: "Tool use was denied." } });
        if (closed.count === 0) throw new ApprovalAlreadyDecidedError();
      });
    } catch (error) { return asConflict(error); }
    await log.emit("approval_resolved", `Denied ${String(payload.tool ?? "tool")}.`, { decision, approvalRequestId: approval.id });
    return { status: "cancelled" as const, resumedTaskId: null, enqueued: false };
  }

  // Every check that can refuse the continuation runs BEFORE anything is decided. If one does (the bot was disabled,
  // its policy refuses, the tool left the catalog) nothing has changed: the approval is still pending and the task still
  // waiting, so the reviewer can retry or deny.
  const request = asRecord(run.request);
  const approvedKeys = await approvedKeysFor(payload, run.workspaceId);
  const admission = await admitTask(run.botId, {
    task: String(request.task ?? ""), context: typeof request.context === "string" ? request.context : undefined,
    projectId: run.projectId ?? undefined, modelRole: (["primary", "fast", "reasoning", "vision"].includes(String(request.modelRole)) ? request.modelRole : "primary") as "primary",
  }, { kind: "user", userId: run.userId }, { mode: request.mode === "test" ? "test" : "delegate", originKey: run.originKey ?? `user:${run.userId}` });
  if ("existingId" in admission) throw new BotTaskError("The continuation already exists.", 409);

  let child: OrchestrationRun;
  try {
    child = await db.$transaction(async (tx) => {
      await decideApprovalIn(tx, approval.id, "approved", viewer.userId, options.decisionNote);
      // Inherit only what the waiting task did not spend. The original request's approvedTools is a record of what
      // was issued, not of what is left: copying it would hand an already-used permission to the continuation.
      const unspent = await tx.botToolGrant.findMany({ where: { runId: run.id, consumedAt: null }, select: { key: true } });
      const grants: GrantSpec[] = [
        ...unspent.map((grant) => ({ key: grant.key, sourceRunId: run.id })),
        ...approvedKeys.map((key) => ({ key, approvalRequestId: approval.id })),
      ];
      const created = await insertTaskRun(tx, admission.admitted, grants, run.id);
      const closed = await tx.orchestrationRun.updateMany({ where: { id: run.id, status: "waiting" }, data: { status: "cancelled", completedAt: new Date(), error: `Approved and continued as task ${created.id}.` } });
      if (closed.count === 0) throw new ApprovalAlreadyDecidedError();
      await tx.approvalRequest.update({ where: { id: approval.id }, data: { payload: { ...payload, continuation: { runId: created.id, pendingEnqueue: true } satisfies ContinuationMarker } as unknown as Prisma.InputJsonValue } });
      return created;
    });
  } catch (error) { return asConflict(error); }

  await log.emit("approval_resolved", `Approved ${String(payload.tool ?? "tool")}.`, { decision, approvalRequestId: approval.id, continuationTaskId: child.id });
  await recordQueued(child, admission.admitted).catch(() => undefined);
  const outcome = await enqueueContinuation(approval.id, child.id);
  if (!outcome.enqueued) {
    await new BotRunLog(run.botId, child.id).emit("warning", `Approved, but the continuation could not be queued yet (${outcome.error}). It will be retried.`).catch(() => undefined);
  }
  return { status: "resumed" as const, resumedTaskId: child.id, enqueued: outcome.enqueued, ...(outcome.error ? { warning: `Approved. The continuation is waiting to be queued: ${outcome.error}` } : {}) };
}

export type { BotTaskStatus };
