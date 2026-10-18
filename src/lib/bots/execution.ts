// Bot-specific behaviour inside the orchestration executor. The executor keeps
// owning the lease, the queue, cancellation and the retry guard; this object is
// what it consults at the points where a bot run differs from an ordinary one:
// what to send, which model to ask for, whether a tool call is permitted, and
// what to record afterwards.
//
// Enforcement, stated exactly because it is easy to overstate. Hermes calls its tools itself. Which of
// two modes a task runs in is decided by the runtime when the session starts (`metadata.toolGate`):
//  - "pre-execution": the host runs the sentinel-bot-gate plugin, so Hermes asks `authorize` before each
//    tool call runs and blocks the call unless Sentinel answers yes. A denied or approval-gated call never
//    starts; Sentinel then interrupts the session. A call that starts without having been asked about means
//    the gate was bypassed on the host; Sentinel halts the task after the fact and says so.
//  - "observed" (any host without the gate): detect-and-halt. Sentinel sees each call as the runtime
//    announces it and interrupts afterwards; the call that triggered the halt may already be under way.
// The prompt manifest asks the bot not to try a forbidden tool in either mode; it is not enforcement.

import type { OrchestrationRun, Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { userHasWorkspacePermission } from "@/lib/workspaces/authorization";
import { calculateModelCost } from "@/lib/agents/pricing";
import type { AgentSession, RuntimeEvent, ToolAuthorizer } from "@/lib/agents/runtime/types";
import { activeCatalog, loadCatalog } from "./catalog";
import { BotRunLog } from "./events";
import { readBotMemory, writeBotMemory } from "./memory";
import { selectBotModel } from "./models";
import { evaluateObservedTool, resolveObservedTool, renderToolManifest, type CatalogServer, type PermissionRow, type ResolvedTool } from "./policy";
import { buildBotPrompt } from "./prompt";
import { getBotRow, toBotRecord, toGrant, type BotRecord } from "./service";

const asRecord = (value: unknown): Record<string, unknown> => (value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {});
const asString = (value: unknown): string | null => (typeof value === "string" && value ? value : null);
const num = (value: unknown): number | null => (typeof value === "number" && Number.isFinite(value) ? value : null);
const json = (value: unknown) => value as Prisma.InputJsonValue;

export interface Halt {
  kind: "violation" | "approval";
  /** The name the runtime reported. For display and the audit trail only. */
  tool: string;
  /** The catalog's own name for the tool, when it resolved to one. This is what approvals are stored and matched under. */
  catalogTool?: string | null;
  server: string | null;
  serverId: string | null;
  /** Canonical `<serverId>:<catalog tool>` keys that approving this halt approves. Empty for a violation. */
  approvalKeys?: string[];
  reason: string;
  risk: "normal" | "high";
  /** True when the call was refused before it ran (pre-execution gate). False/absent: seen after it started. */
  preExecution?: boolean;
}

export interface HaltContext { attemptId: string; startedAtMs: number; text: string }

/**
 * A runtime session that Sentinel asked to stop and could not confirm stopped.
 * It may still be executing, so the task is neither halted nor parked: it stays
 * tracked, holding its lease, until a later attempt gets a confirmation.
 */
export interface PendingInterruption extends HaltContext {
  /** Why the session was being stopped: a policy halt, or a cancellation the user asked for. */
  cause: { kind: "halt"; halt: Halt } | { kind: "cancel" };
  sessionId: string;
  /** The worker that holds the execution lease for this run. Only it may be released by the reconciler. */
  workerId: string;
  firstUnconfirmedAt: string;
  lastCheckedAt: string;
  checks: number;
  lastMessage: string;
}

export interface ModelOverride { model: string; effort?: import("@/lib/agents/model-policy").EffortLevel | null; authorized: true }

export interface BotExecution {
  readonly bot: BotRecord;
  readonly requestedModel: string | null;
  readonly modelOverride: ModelOverride | undefined;
  prepare(): Promise<string>;
  /** An explicit, operator-chosen fallback for a session that failed to start on an unavailable model. */
  fallbackOverride(error: unknown): ModelOverride | null;
  noteFallback(from: string | null, to: string): Promise<void>;
  /** Read how the runtime will let Sentinel govern this session's tools. Call once the session exists. */
  useSession(session: AgentSession): Promise<void>;
  /** Pre-execution decision for one tool call, given to the runtime's send(). Refusals park a halt that observe() returns. */
  readonly authorizeTool: ToolAuthorizer;
  observe(event: RuntimeEvent): Promise<Halt | null>;
  halted(halt: Halt, context: HaltContext): Promise<void>;
  /** The runtime did not confirm it stopped. Keep the task tracked as in-flight; do not halt, park or release it. */
  interruptionUnconfirmed(pending: PendingInterruption): Promise<void>;
  attemptFields(): { usage: Prisma.InputJsonValue; cost: number | null; model?: string };
  finish(text: string, succeeded: boolean): Promise<void>;
  /** An error the runtime reported inside an otherwise normal-looking turn (Hermes does this for provider errors). */
  runtimeError(): string | null;
  recordFailure(message: string): Promise<void>;
}

const MEDIA = /https?:\/\/[^\s)"'<>\]]+?\.(png|jpe?g|webp|gif|mp4|mov|webm|mp3|wav|pdf)(?:\?[^\s)"'<>\]]*)?/gi;
const mediaType = (ext: string) => (/^(png|jpe?g|webp|gif)$/i.test(ext) ? "image" : /^(mp4|mov|webm)$/i.test(ext) ? "video" : /^(mp3|wav)$/i.test(ext) ? "audio" : "document");

async function failRun(run: OrchestrationRun, log: BotRunLog | null, message: string): Promise<void> {
  await db.orchestrationRun.updateMany({ where: { id: run.id, status: { in: ["queued", "running"] } }, data: { status: "failed", error: message, completedAt: new Date() } });
  if (log) await log.emit("error", message);
}

/**
 * The one-use tool approvals this task still holds, read from BotToolGrant rows (the authority:
 * they are spent durably and inherited by continuations). A task queued by the release before
 * grants existed has only `request.approvedTools`; those are written out as rows the first time
 * it loads. skipDuplicates means a row that was already spent is never resurrected by a reload.
 */
async function loadUnspentGrants(runId: string, request: Record<string, unknown>): Promise<string[]> {
  if (request.grantsVersion !== 2 && Array.isArray(request.approvedTools) && request.approvedTools.length) {
    await db.botToolGrant.createMany({ data: [...new Set(request.approvedTools.map(String))].map((key) => ({ runId, key })), skipDuplicates: true });
  }
  return (await db.botToolGrant.findMany({ where: { runId, consumedAt: null }, select: { key: true } })).map((grant) => grant.key);
}

/**
 * Returns null after failing the run itself when the bot cannot execute (gone,
 * or disabled for a real delegation). The executor then returns without
 * throwing: a throw would hand the run to the queue's retry handling, which
 * resets it to "queued" and would leave it stranded there.
 */
export async function loadBotExecution(run: OrchestrationRun): Promise<BotExecution | null> {
  const row = run.botId ? await getBotRow(run.botId) : null;
  if (!row) { await failRun(run, null, "The bot no longer exists."); return null; }
  const bot = toBotRecord(row);
  const log = new BotRunLog(bot.id, run.id);
  const request = asRecord(run.request);
  const telegramChannel = asRecord(request.channel);
  const mode = request.mode === "test" ? "test" : "delegate";
  if (mode !== "test" && bot.status !== "active") { await failRun(run, log, `${bot.name} is ${bot.status}, so it cannot run delegated tasks.`); return null; }

  const task = String(request.task ?? "");
  let rows: PermissionRow[] = row.toolPermissions.map(toGrant);
  let catalog: CatalogServer[] = activeCatalog(await loadCatalog(bot.workspaceId));
  const approvedOnce = new Set<string>(await loadUnspentGrants(run.id, request));
  const role = (["primary", "fast", "reasoning", "vision"].includes(String(request.modelRole)) ? request.modelRole : "primary") as "primary" | "fast" | "reasoning" | "vision";
  const requestedModel = selectBotModel(bot.modelConfig, role);
  const modelOverride: ModelOverride | undefined = requestedModel ? { model: requestedModel, ...(bot.modelConfig.effort !== undefined ? { effort: bot.modelConfig.effort } : {}), authorized: true } : undefined;

  const pending = new Set<string>();
  let gate: "pre-execution" | "observed" = "observed";
  /** Calls the pre-execution gate admitted and the runtime has not yet reported starting, by reported name. */
  const admitted = new Map<string, number>();
  /** A refusal made inside authorizeTool, handed to the executor by the next observe(). The first one wins. */
  let parkedHalt: Halt | null = null;
  let parkedHaltReturned = false;
  let usage: { inputTokens: number | null; outputTokens: number | null; totalTokens: number | null; model: string | null } | null = null;
  let actualModel: string | null = null;
  let provider: string | null = null;
  let toolCalls = 0;
  let reportedError: string | null = null;

  /**
   * One policy decision for one call, the same whether it is asked before the call runs or seen after it
   * started. Returns null when the call is permitted (spending any one-use grant it used), else the halt.
   */
  async function decide(name: string, stage: "pre-execution" | "observed"): Promise<Halt | null> {
    toolCalls += 1;
    let verdict = evaluateObservedTool(rows, name, catalog, approvedOnce);
    // An approval is for ONE use: admitting this call spends it, durably, so neither a restart nor the
    // continuation of this task can spend it again. The spend is a conditional update on the grant row;
    // if another caller spent it first (count 0) this call is NOT admitted by it, and is evaluated again without.
    for (let round = 0; verdict.allowed && verdict.consumed.length && round < 4; round += 1) {
      let lost = false;
      for (const key of verdict.consumed) {
        approvedOnce.delete(key);
        const spent = await db.botToolGrant.updateMany({ where: { runId: run.id, key, consumedAt: null }, data: { consumedAt: new Date() } });
        if (spent.count === 0) lost = true;
      }
      if (!lost) break;
      verdict = evaluateObservedTool(rows, name, catalog, approvedOnce);
    }
    const resolved: ResolvedTool | null = verdict.resolved;
    const details = { tool: name, server: resolved?.serverName ?? null, serverId: resolved?.serverId ?? null, permission: verdict.permission, source: verdict.source, reason: verdict.reason, stage };
    if (verdict.allowed) { await log.emit("tool_allowed", `${name} allowed.`, details); return null; }
    const risk = resolved ? (catalog.find((server) => server.id === resolved.serverId)?.tools.find((tool) => tool.name === resolved.toolName)?.risk ?? "normal") : "normal";
    const preExecution = stage === "pre-execution";
    if (verdict.requiresApproval) return { kind: "approval", tool: name, catalogTool: resolved?.toolName ?? null, server: details.server, serverId: details.serverId, approvalKeys: verdict.approvalKeys, reason: verdict.reason, risk, preExecution };
    await log.emit("tool_denied", `${name} denied: ${verdict.reason}`, details);
    return { kind: "violation", tool: name, catalogTool: resolved?.toolName ?? null, server: details.server, serverId: details.serverId, reason: verdict.reason, risk, preExecution };
  }

  const execution: BotExecution = {
    bot, requestedModel, modelOverride,

    async prepare() {
      await log.emit("started", `Started on ${bot.runtimeAgentId}.`, { host: bot.runtimeAgentId, mode });
      await log.emit("model", `Requested ${requestedModel ?? "the runtime's default model"}.`, { requested: requestedModel, role, effort: bot.modelConfig.effort ?? null });
      const memory = await readBotMemory(bot, { userId: run.userId, query: task, projectId: run.projectId, workspaceId: run.workspaceId, runId: run.id });
      await log.emit("memory_read", memory.skipped ?? `Read ${memory.injected} of ${memory.retrieved} memories.`, { retrieved: memory.retrieved, injected: memory.injected, dropped: memory.dropped, scopes: memory.scopes, skipped: memory.skipped ?? null, tokens: memory.estimatedTokens });
      await db.orchestrationRun.update({
        where: { id: run.id },
        data: { contextSnapshot: json({ ...asRecord(run.contextSnapshot), memory: { retrieved: memory.retrieved, injected: memory.injected, dropped: memory.dropped, contextTokens: memory.estimatedTokens } }) },
      }).catch(() => undefined);
      const skills = row.skills.filter((link) => link.enabled && link.skill.status === "active" && link.skill.body).map((link) => ({ name: link.skill.name, body: link.skill.body as string }));
      return buildBotPrompt({
        bot, skills, toolManifest: renderToolManifest(rows, catalog), memoryText: memory.text,
        context: asString(request.context) ?? undefined, task,
      });
    },

    fallbackOverride(error) {
      const fallback = bot.modelConfig.fallback;
      const code = (error as { code?: string } | null)?.code;
      if (code !== "MODEL_UNAVAILABLE" || !fallback || fallback === requestedModel) return null;
      return { model: fallback, ...(bot.modelConfig.effort !== undefined ? { effort: bot.modelConfig.effort } : {}), authorized: true };
    },
    async noteFallback(from, to) {
      await log.emit("model", `Requested model was unavailable; using the bot's configured fallback ${to}.`, { requested: from, fallback: to, requestedOriginal: from });
    },

    async useSession(session) {
      const channel = telegramChannel;
      if (channel.kind === "telegram") {
        const inbox = typeof channel.updateId === "string" ? await db.telegramUpdate.findUnique({ where: { id: channel.updateId }, include: { bot: true } }) : null;
        const access = inbox ? await db.telegramAccess.findUnique({ where: { telegramBotId_senderId_chatId: { telegramBotId: inbox.telegramBotId, senderId: inbox.senderId, chatId: inbox.chatId } } }) : null;
        if (!inbox || !access?.enabled || access.userId !== run.userId || !await userHasWorkspacePermission(run.userId, inbox.bot.workspaceId, "agents.runtime.execute") || inbox.bot.botId !== bot.id || inbox.bot.agentId !== bot.runtimeAgentId || inbox.userId !== run.userId || inbox.bot.workspaceId !== run.workspaceId || session.metadata?.sessionSource !== `sentinel-telegram:${inbox.id}` || session.metadata?.toolGate !== "pre-execution") throw new Error("Trusted Telegram execution identity or tool gate is unavailable");
      }
      gate = session.metadata?.toolGate === "pre-execution" ? "pre-execution" : "observed";
      await log.emit("tool_gate", gate === "pre-execution"
        ? "Tool calls are checked before they run."
        : "Tool calls are checked as the runtime reports them; a refused call may already have started.", { gate });
    },

    async authorizeTool(request) {
      // Once a call has been refused the task is stopping; nothing else may start in the meantime.
      if (parkedHalt) return { allow: false, reason: "The task is stopping." };
      if (telegramChannel.kind === "telegram") {
        const inbox = await db.telegramUpdate.findUnique({ where: { id: String(telegramChannel.updateId) }, include: { bot: true } });
        const access = inbox ? await db.telegramAccess.findUnique({ where: { telegramBotId_senderId_chatId: { telegramBotId: inbox.telegramBotId, senderId: inbox.senderId, chatId: inbox.chatId } } }) : null;
        const currentBot = await getBotRow(bot.id);
        if (!inbox || !inbox.bot.enabled || !access?.enabled || access.userId !== run.userId || currentBot?.status !== "active" || currentBot.runtimeAgentId !== inbox.bot.agentId || !await userHasWorkspacePermission(run.userId, bot.workspaceId, "agents.runtime.execute")) {
          parkedHalt = { kind: "violation", tool: request.tool, server: null, serverId: null, reason: "Telegram execution authority was revoked.", risk: "high", preExecution: true };
          await log.emit("tool_denied", parkedHalt.reason, { tool: request.tool, stage: "pre-execution" });
          return { allow: false, reason: parkedHalt.reason };
        }
        rows = currentBot.toolPermissions.map(toGrant);
        catalog = activeCatalog(await loadCatalog(bot.workspaceId));
      }
      if (request.kind === "runtime-approval") {
        const reason = "The runtime asked for approval of an action; bot tasks run unattended, so it was refused before it ran.";
        await log.emit("tool_denied", `${request.tool || "runtime action"} denied: ${reason}`, { tool: request.tool || null, server: null, serverId: null, permission: "none", source: "runtime-approval", reason, stage: "pre-execution" });
        parkedHalt = { kind: "violation", tool: request.tool || "runtime approval", server: null, serverId: null, reason, risk: "high", preExecution: true };
        return { allow: false, reason };
      }
      if (telegramChannel.kind === "telegram" && resolveObservedTool(request.tool, catalog).length !== 1) {
        parkedHalt = { kind: "violation", tool: request.tool, server: null, serverId: null, reason: "Tool identity is unknown or ambiguous.", risk: "high", preExecution: true };
        return { allow: false, reason: parkedHalt.reason };
      }
      const halt = await decide(request.tool, "pre-execution");
      if (!halt) { admitted.set(request.tool, (admitted.get(request.tool) ?? 0) + 1); return { allow: true, reason: "Permitted by the bot's grants." }; }
      parkedHalt = halt;
      return { allow: false, reason: halt.reason };
    },

    async observe(event) {
      if (parkedHalt && !parkedHaltReturned) { parkedHaltReturned = true; return parkedHalt; }
      const data = asRecord(event.data);
      switch (event.type) {
        case "status": {
          if (typeof data.model === "string") actualModel = data.model;
          if (typeof data.provider === "string") provider = data.provider;
          // Hermes narrates a failed provider call as a lifecycle line before its final turn.
          if (data.kind === "lifecycle" && typeof data.text === "string" && data.text.startsWith("❌")) reportedError = data.text.slice(0, 300);
          return null;
        }
        case "tool_started": {
          const name = asString(data.name);
          if (gate === "pre-execution") {
            // `tool.generating` streams while the model is still writing the call, before Hermes's pre-call hook;
            // the decision is made at that hook. `tool.start` is the call actually beginning.
            if (!name || data.phase !== "tool.start") return null;
            const left = admitted.get(name) ?? 0;
            if (left > 0) { admitted.set(name, left - 1); return null; }
            const reason = "The call started without passing Sentinel's pre-execution check, so the gate on the runtime host was bypassed or is not installed. Sentinel stopped the session after the call began.";
            await log.emit("tool_denied", `${name} denied: ${reason}`, { tool: name, server: null, serverId: null, permission: "none", source: "ungated", reason, stage: "observed" });
            return { kind: "violation", tool: name, server: null, serverId: null, reason, risk: "high" };
          }
          if (!name || pending.has(name)) return null;
          pending.add(name);
          return decide(name, "observed");
        }
        case "tool_completed": {
          const name = asString(data.name);
          if (name) pending.delete(name);
          const result = asRecord(data.result);
          await log.emit("tool_completed", `${name ?? "tool"} finished.`, { tool: name, argKeys: Object.keys(asRecord(data.args)), failed: typeof result.error === "string" });
          return null;
        }
        case "approval_required":
          // An older Hermes announcing its own approval prompt as an event, which Sentinel cannot answer. A bot runs unattended.
          return { kind: "violation", tool: asString(data.tool_name) ?? "runtime approval", server: null, serverId: null, reason: "The runtime asked for approval of an action; bot tasks run unattended, so it was not granted.", risk: "high" };
        case "completed": {
          if (typeof data.error === "string" && data.error) reportedError = `${data.error}`.slice(0, 300);
          const reported = asRecord(data.usage);
          const input = num(reported.input) ?? num(reported.prompt);
          const output = num(reported.output) ?? num(reported.completion);
          const total = num(reported.total) ?? (input !== null && output !== null ? input + output : null);
          if (input !== null || output !== null || total !== null) usage = { inputTokens: input, outputTokens: output, totalTokens: total, model: asString(reported.model) };
          return null;
        }
        default:
          return null;
      }
    },

    async halted(halt, context) {
      const latencyMs = Date.now() - context.startedAtMs;
      if (halt.kind === "approval") {
        const approval = await db.approvalRequest.create({
          data: {
            workspaceId: run.workspaceId!, projectId: run.projectId, type: "bot_tool_call", risk: halt.risk === "high" ? "high" : "medium",
            title: `${bot.name} wants to use ${halt.tool}`, description: halt.preExecution
              ? `Bot task ${run.id} called ${halt.tool}${halt.server ? ` (${halt.server})` : ""}. Sentinel's pre-execution check refused the call before it ran and then stopped the session. Approve to continue as a new task that may use it once.`
              : `Bot task ${run.id} called ${halt.tool}${halt.server ? ` (${halt.server})` : ""}. Sentinel saw the call as the runtime started it and then interrupted the session, so the tool may already have begun running. Approve to continue as a new task that may use it once.`,
            requesterUserId: run.userId,
            // Stored under the catalog's names, not the runtime's spelling (Hermes reports MCP tools as
            // `mcp_<slug>_<tool>`): evaluateToolAccess matches on `<serverId>:<catalog tool>`, so an
            // approval recorded under the reported name would never be recognised on resume.
            payload: json({ runId: run.id, botId: bot.id, serverId: halt.serverId, tool: halt.catalogTool ?? halt.tool, reportedTool: halt.tool, approvalKeys: halt.approvalKeys ?? [] }),
          },
        });
        const stage = halt.preExecution ? "pre-execution" : "observed";
        await log.emit("approval_requested", `${halt.tool} needs approval; task is waiting.`, { tool: halt.tool, server: halt.server, serverId: halt.serverId, reason: halt.reason, approvalRequestId: approval.id, stage });
        await db.$transaction([
          db.executionAttempt.update({ where: { id: context.attemptId }, data: { status: "halted", completedAt: new Date(), latencyMs, output: json({ text: context.text }), validation: json({ passed: false, reason: "Waiting for tool approval." }) } }),
          db.orchestrationRun.update({ where: { id: run.id }, data: { status: "waiting", result: json({ text: context.text, waitingFor: { approvalRequestId: approval.id, tool: halt.tool, stage } }) } }),
        ]);
        return;
      }
      const message = `policy_violation: ${halt.tool} is not permitted — ${halt.reason}${halt.preExecution ? " (refused before it ran)" : ""}`;
      await log.emit("error", `Task stopped: ${message}`, { tool: halt.tool, reason: halt.reason });
      await db.$transaction([
        db.executionAttempt.update({ where: { id: context.attemptId }, data: { status: "failed", error: message, completedAt: new Date(), latencyMs, output: json({ text: context.text }), validation: json({ passed: false, reason: message }) } }),
        db.orchestrationRun.update({ where: { id: run.id }, data: { status: "failed", error: message, completedAt: new Date(), result: json({ text: context.text, halted: true }) } }),
      ]);
    },

    async interruptionUnconfirmed(pending) {
      const what = pending.cause.kind === "halt" ? `stopping the session after ${pending.cause.halt.tool}` : "cancelling the session";
      const message = `The runtime did not confirm ${what}: ${pending.lastMessage}. The session may still be executing, so the task stays open until it is confirmed stopped.`;
      await log.emit("error", message, { sessionId: pending.sessionId, cause: pending.cause.kind, tool: pending.cause.kind === "halt" ? pending.cause.halt.tool : null, checks: pending.checks });
      await db.$transaction([
        db.executionAttempt.update({ where: { id: pending.attemptId }, data: { validation: json({ passed: false, reason: "Runtime interruption unconfirmed; session may still be running." }) } }),
        // `cancelling` is in-flight everywhere (concurrency, co-execution) and is never finalized by a retry, so
        // the run keeps its slot and nothing can start a second session for it.
        db.orchestrationRun.update({ where: { id: run.id }, data: { status: "cancelling", error: message, result: json({ text: pending.text, interruptUnconfirmed: pending }) } }),
      ]);
    },

    attemptFields() {
      const model = usage?.model ?? actualModel ?? requestedModel ?? undefined;
      const cost = usage && model && usage.inputTokens !== null && usage.outputTokens !== null
        ? calculateModelCost(model, { inputTokens: usage.inputTokens, outputTokens: usage.outputTokens, cachedInputTokens: 0, cacheWrite5mInputTokens: 0, cacheWrite1hInputTokens: 0 })
        : null;
      return { usage: json(usage ? { inputTokens: usage.inputTokens, outputTokens: usage.outputTokens, totalTokens: usage.totalTokens, model: usage.model, toolCalls } : {}), cost, ...(model ? { model } : {}) };
    },

    async finish(text, succeeded) {
      try {
        const fields = execution.attemptFields();
        await log.emit("usage", usage ? `${usage.totalTokens ?? "?"} tokens.` : "The runtime reported no token usage.", { ...asRecord(fields.usage), model: usage?.model ?? actualModel, provider, costUsd: fields.cost });
        const limit = bot.limits.maxTokensPerTask;
        if (limit && usage?.totalTokens && usage.totalTokens > limit) await log.emit("warning", `Used ${usage.totalTokens} tokens, over this bot's per-task budget of ${limit}. Budgets are checked after the fact; the runtime does not report usage mid-task.`);
        if (succeeded) {
          const seen = new Set<string>();
          for (const match of text.matchAll(MEDIA)) {
            if (seen.has(match[0]) || seen.size >= 25) continue;
            seen.add(match[0]);
            await db.executionArtifact.create({ data: { orchestrationRunId: run.id, type: mediaType(match[1]), title: decodeURIComponent(match[0].split("/").pop()?.split("?")[0] ?? "asset"), storageUrl: match[0], metadata: json({ source: "output-url", note: "Found in the bot's output; Sentinel has not fetched or verified it." }) } });
          }
          const write = await writeBotMemory(bot, {
            userId: run.userId, runId: run.id, projectId: run.projectId, workspaceId: run.workspaceId,
            content: `${bot.name} task: ${task.slice(0, 300)}\nOutcome: ${text.replace(/\s+/g, " ").trim().slice(0, 700)}`, tags: ["bot-task"],
          });
          await log.emit("memory_write", write.denied ?? (write.accepted ? `Remembered at ${write.scope} scope.` : "Memory gate declined to store it."), { scope: write.scope, accepted: write.accepted, denied: write.denied ?? null, memoryId: write.memoryId, reasons: write.reasons });
        }
        await log.emit("completed", succeeded ? "Task completed." : "Task ended without output.");
      } catch (error) {
        await log.emit("warning", `Post-run bookkeeping failed: ${error instanceof Error ? error.message : String(error)}`).catch(() => undefined);
      }
    },

    runtimeError() { return reportedError; },

    async recordFailure(message) {
      await log.emit("error", message).catch(() => undefined);
    },
  };
  return execution;
}

