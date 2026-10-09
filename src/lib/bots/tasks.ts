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
import { decideApproval } from "@/lib/workspaces/approvals";
import { BotRunLog } from "./events";
import { activeCatalog, loadCatalog } from "./catalog";
import { approvalKey, evaluateDelegation, resolveObservedTool, type DelegationParent } from "./policy";
import { toBotRecord } from "./service";
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
  /** Bot task ids whose tools the requester has already approved. Only set by resume. */
  approvedTools?: string[];
  /** Continue an already-authorised task as this caller (an approval resume) instead of the requester. */
  originKey?: string;
}

export async function delegateToBot(botId: string, rawInput: DelegateTaskInput, caller: BotCaller, options: DelegateOptions = {}) {
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
    if (existing) return getBotTask(existing.id, { userId: caller.userId, isAdmin: false });
  }

  const run = await db.orchestrationRun.create({
    data: {
      userId: caller.userId, workspaceId: bot.workspaceId, projectId, botId: bot.id, originKey: key,
      parentRunId: parentRun?.id ?? null, idempotencyKey: input.idempotencyKey ?? null,
      request: {
        task: input.task, context: input.context ?? null, modelRole: input.modelRole, mode, botName: bot.name,
        ...(options.approvedTools?.length ? { approvedTools: options.approvedTools } : {}),
      } as Prisma.InputJsonValue,
      requestedAgentId: bot.runtimeAgentId, resolvedAgentId: bot.runtimeAgentId,
      routingDecision: { kind: "bot", botId: bot.id, host: bot.runtimeAgentId, reason: `Delegated to bot ${bot.name}.` } as Prisma.InputJsonValue,
      contextSnapshot: { scope: { workspaceId: bot.workspaceId, projectId } } as Prisma.InputJsonValue,
    },
  });
  await new BotRunLog(bot.id, run.id).emit("queued", `Task queued by ${key}.`, { caller: key, mode, modelRole: input.modelRole });
  if (parentRun?.botId) await new BotRunLog(parentRun.botId, parentRun.id).emit("delegated", `Delegated to ${bot.name}.`, { childTaskId: run.id, childBotId: bot.id });
  await writeAuditLog({
    workspaceId: bot.workspaceId, projectId, userId: caller.userId, actorType: caller.kind === "user" ? "user" : "agent",
    agentId: caller.kind === "agent" ? caller.agentId : null, action: "bot.task.queued", entityType: "orchestration_run", entityId: run.id,
    details: { botId: bot.id, caller: key, mode },
  });
  try {
    await enqueueOrchestrationRun(run.id);
  } catch (error) {
    // The run row exists but nothing will ever pick it up. Say so, rather than leaving a task that reads QUEUED forever.
    const message = error instanceof Error ? error.message : "Queue unavailable";
    await db.orchestrationRun.update({ where: { id: run.id }, data: { status: "failed", error: `Could not be queued: ${message}`, completedAt: new Date() } });
    await new BotRunLog(bot.id, run.id).emit("error", `Could not be queued: ${message}`);
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
    await db.$transaction([
      db.orchestrationRun.update({ where: { id: run.id }, data: { status: "cancelled", completedAt: new Date() } }),
      db.approvalRequest.updateMany({ where: { status: "pending", payload: { path: ["runId"], equals: run.id } }, data: { status: "rejected", decidedAt: new Date(), decisionNote: "Task was cancelled." } }),
    ]);
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
 * The canonical `<serverId>:<catalog tool>` keys an approval grants. New approvals
 * carry them. An approval created before that (or by hand) only has the name the
 * runtime reported, so it is resolved against the catalog now rather than trusted
 * as-is: `mcp_<slug>_<tool>` is not a name evaluateToolAccess would ever look up.
 */
async function approvedKeysFor(payload: Record<string, unknown>, workspaceId: string | null): Promise<string[]> {
  if (Array.isArray(payload.approvalKeys) && payload.approvalKeys.length) return payload.approvalKeys.map(String);
  const tool = String(payload.tool ?? "");
  const serverId = typeof payload.serverId === "string" ? payload.serverId : null;
  if (workspaceId) {
    const resolved = resolveObservedTool(tool, activeCatalog(await loadCatalog(workspaceId))).filter((candidate) => !serverId || candidate.serverId === serverId);
    if (resolved.length) return resolved.map((candidate) => approvalKey(candidate.serverId, candidate.toolName));
  }
  return serverId ? [approvalKey(serverId, tool)] : [];
}

/**
 * Resolve the approval a WAITING task stopped for. Approving starts a NEW task
 * (a child of the waiting one) that may use that one tool; the waiting task is
 * closed, because a runtime session that has been interrupted cannot be resumed
 * safely. Denying simply closes it.
 */
export async function resolveBotTaskApproval(
  taskId: string,
  decision: "approve" | "deny",
  viewer: TaskViewer & { isAdmin: true },
  options: { decisionNote?: string } = {},
) {
  const run = await db.orchestrationRun.findFirst({ where: { id: taskId, botId: { not: null }, status: "waiting" } });
  if (!run || !run.botId) throw new BotTaskError("Task is not waiting for approval", 404);
  const approval = await db.approvalRequest.findFirst({ where: { status: "pending", payload: { path: ["runId"], equals: run.id } } });
  if (!approval) throw new BotTaskError("No pending approval for this task", 404);
  const payload = asRecord(approval.payload);
  const log = new BotRunLog(run.botId, run.id);
  const decide = async (status: "approved" | "rejected") => {
    try { return await decideApproval(approval.id, status, viewer.userId, options.decisionNote); }
    catch { throw new BotTaskError("This approval was already decided", 409); }
  };

  if (decision === "deny") {
    await decide("rejected");
    await log.emit("approval_resolved", `Denied ${String(payload.tool ?? "tool")}.`, { decision, approvalRequestId: approval.id });
    await db.orchestrationRun.update({ where: { id: run.id }, data: { status: "cancelled", completedAt: new Date(), error: "Tool use was denied." } });
    return { status: "cancelled" as const, resumedTaskId: null };
  }

  // The continuation is created BEFORE the approval is decided. If it cannot be (the bot was disabled, its policy
  // refuses, the queue is down) nothing has changed: the approval is still pending and the task still waiting, so the
  // reviewer can retry or deny. Deciding first stranded the task behind an approval that no longer read as pending.
  const request = asRecord(run.request);
  const child = await delegateToBot(run.botId, {
    task: String(request.task ?? ""), context: typeof request.context === "string" ? request.context : undefined,
    projectId: run.projectId ?? undefined, modelRole: (["primary", "fast", "reasoning", "vision"].includes(String(request.modelRole)) ? request.modelRole : "primary") as "primary",
  }, { kind: "user", userId: run.userId }, {
    mode: request.mode === "test" ? "test" : "delegate", originKey: run.originKey ?? `user:${run.userId}`,
    approvedTools: [...new Set([...(Array.isArray(request.approvedTools) ? request.approvedTools.map(String) : []), ...(await approvedKeysFor(payload, run.workspaceId))])],
  });
  try {
    await decide("approved");
  } catch (error) {
    // Someone decided it between our read and now: do not leave a second session queued beside theirs.
    await db.orchestrationRun.updateMany({ where: { id: child.id, status: "queued" }, data: { status: "cancelled", completedAt: new Date(), error: "The approval was decided elsewhere." } });
    throw error;
  }
  await log.emit("approval_resolved", `Approved ${String(payload.tool ?? "tool")}.`, { decision, approvalRequestId: approval.id });
  await db.orchestrationRun.update({ where: { id: run.id }, data: { status: "cancelled", completedAt: new Date(), error: `Approved and continued as task ${child.id}.` } });
  await db.orchestrationRun.update({ where: { id: child.id }, data: { parentRunId: run.id } });
  return { status: "resumed" as const, resumedTaskId: child.id };
}

export type { BotTaskStatus };
