import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { HOST, resetScript, script, toolCall, turn } from "./fake-runtime";

vi.mock("@/lib/agents/runtime/service", async () => (await import("./fake-runtime")).serviceMock);
vi.mock("@/lib/orchestration/queue", () => ({ enqueueOrchestrationRun: vi.fn().mockResolvedValue(undefined) }));

import { db } from "@/lib/db";
import { executeOrchestrationRun, reconcileUnconfirmedInterruptions } from "@/lib/orchestration/executor";
import { redisKeys } from "@/lib/redis";
import { HERMES_BUILTIN_SERVER_ID } from "@/lib/bots/catalog";
import { createBot, disableBot, type BotRecord } from "@/lib/bots/service";
import { cancelBotTask, delegateToBot, getBotTask, resolveBotTaskApproval, type BotCaller } from "@/lib/bots/tasks";
import type { CreateBotInput, GrantToolInput } from "@/lib/bots/schema";
import { botInput, makeWorkspace } from "./fixtures";

let owner: { id: string }; let workspace: { id: string };
const asOwner = (): BotCaller => ({ kind: "user", userId: owner.id });
const viewer = () => ({ userId: owner.id, isAdmin: true as const });

beforeAll(async () => { ({ owner, workspace } = await makeWorkspace()); });
beforeEach(() => { resetScript(); process.env.SENTINEL_INTERRUPT_RETRY_MS = "0"; });

async function activeBot(over: Partial<CreateBotInput> = {}, grants: GrantToolInput[] = []): Promise<BotRecord> {
  return createBot(botInput(workspace.id, { status: "active", systemPrompt: "You are the test bot. Be terse.", ...over }), owner.id, { toolGrants: grants });
}
const read = (toolName: string): GrantToolInput => ({ serverId: HERMES_BUILTIN_SERVER_ID, toolName, permission: "read" });

async function runToEnd(botId: string, task = "Create three concepts for a 15-second ICF construction ad.", extra: Record<string, unknown> = {}) {
  const queued = await delegateToBot(botId, { task, ...extra } as never, asOwner());
  expect(queued.status).toBe("QUEUED"); // nothing has executed yet: QUEUED is real, not faked
  await executeOrchestrationRun(queued.id, `test-worker-${queued.id}`);
  return getBotTask(queued.id, viewer());
}

describe("a bot task end to end (real executor, queue lease, DB; scripted runtime)", () => {
  it("completes with output, usage, model provenance, tool audit, memory events and artifacts", async () => {
    const bot = await activeBot({ modelConfig: { primary: "gpt-5.6-luna", fast: "gpt-5.6-terra", effort: "low" } }, [read("read_file")]);
    script.events = [
      { type: "status", data: { kind: "session_info", model: "actual-model-x", provider: "test-provider" } },
      ...toolCall("read_file"),
      { type: "assistant_delta", data: { text: "Concept 1: storm. See https://cdn.example.com/out/hook-1.mp4 for the cut." } },
      { type: "completed", data: { usage: { input: 1200, output: 80, total: 1280, model: "actual-model-x" } } },
    ];
    const task = await runToEnd(bot.id, "Make a 20-second Titan ICF reel.", { context: "Brand: Titan ICF. Tone: blunt.", modelRole: "fast" });

    expect(task.status).toBe("COMPLETED");
    expect(task.output?.text).toContain("Concept 1");
    expect(task.usage).toEqual({ inputTokens: 1200, outputTokens: 80, totalTokens: 1280 });
    expect(task.cost.usd).toBeNull();                 // unpriced model: no invented number
    expect(task.cost.note).toMatch(/Not priced/);
    expect(task.model).toMatchObject({ requested: "gpt-5.6-terra", actual: "actual-model-x" });
    expect(task.toolCalls).toEqual([expect.objectContaining({ tool: "read_file", decision: "allowed" })]);
    expect(task.events.map((event) => event.type)).toEqual(expect.arrayContaining(["queued", "started", "model", "memory_read", "tool_allowed", "tool_completed", "usage", "memory_write", "completed"]));
    expect(task.artifacts).toEqual([expect.objectContaining({ type: "video", url: "https://cdn.example.com/out/hook-1.mp4" })]);
    expect(task.origin).toBe(`user:${owner.id}`);

    // The runtime was asked for the role's model, explicitly authorised by Sentinel.
    expect(script.startCalls[0].modelOverride).toEqual({ model: "gpt-5.6-terra", effort: "low", authorized: true });
    // What the bot was actually told.
    const prompt = script.prompts[0];
    expect(prompt).toContain("You are Bot");                   // identity
    expect(prompt).toContain("You are the test bot. Be terse.");
    expect(prompt).toMatch(/you MAY use read_file/);
    expect(prompt).toContain("<requester_context>\nBrand: Titan ICF. Tone: blunt.\n</requester_context>");
    expect(prompt.endsWith("Make a 20-second Titan ICF reel.")).toBe(true);

    const attempt = await db.executionAttempt.findFirstOrThrow({ where: { orchestrationRunId: task.id } });
    expect(attempt.status).toBe("succeeded");
    expect(attempt.model).toBe("actual-model-x");
    expect((attempt.usage as { totalTokens: number }).totalTokens).toBe(1280);
  });

  it("stops a bot that calls a tool it was not granted, and says so", async () => {
    const bot = await activeBot({}, [read("read_file")]);
    script.events = [...turn("starting"), ...toolCall("terminal"), ...turn("should never be seen").slice(1)];
    // executor must return normally (never throw into the queue's retry handling)
    const task = await runToEnd(bot.id);
    expect(task.status).toBe("FAILED");
    expect(task.error).toMatch(/policy_violation: terminal is not permitted/);
    expect(script.cancelled).toBe(1);
    expect(task.toolCalls).toEqual([expect.objectContaining({ tool: "terminal", decision: "denied" })]);
    expect(task.output?.text).toBe("starting");         // nothing after the violation was accepted
    expect(task.events.some((event) => event.type === "completed")).toBe(false);
  });

  it("denies a tool that is in no catalog even with a broad builtin grant, and read grants do not cover state-changing tools", async () => {
    const bot = await activeBot({}, [{ serverId: HERMES_BUILTIN_SERVER_ID, toolName: "*", permission: "read" }]);
    script.events = toolCall("write_file");
    expect((await runToEnd(bot.id)).error).toMatch(/write_file is not permitted/);
    script.events = toolCall("createTask"); // an MCP tool Sentinel has never catalogued
    const unknown = await runToEnd(bot.id);
    expect(unknown.error).toMatch(/not in any catalog/);
  });

  it("parks an approval-gated tool call as WAITING, then approving continues as a new task that may use it once", async () => {
    const bot = await activeBot({}, [{ serverId: HERMES_BUILTIN_SERVER_ID, toolName: "terminal", permission: "approval" }]);
    script.events = [...turn("plan").slice(0, 2), ...toolCall("terminal")];
    const waiting = await runToEnd(bot.id, "Run the build.");
    expect(waiting.status).toBe("WAITING");
    expect(waiting.waitingFor?.tool).toBe("terminal");
    expect(script.cancelled).toBe(1);                   // the runtime was interrupted, not left running
    const approval = await db.approvalRequest.findFirstOrThrow({ where: { type: "bot_tool_call", status: "pending", payload: { path: ["runId"], equals: waiting.id } } });
    expect(approval.title).toMatch(/wants to use terminal/);

    resetScript();
    script.events = [...toolCall("terminal"), ...turn("built")];
    const resumed = await resolveBotTaskApproval(waiting.id, "approve", viewer());
    expect(resumed.status).toBe("resumed");
    expect((await getBotTask(waiting.id, viewer())).status).toBe("CANCELLED");
    await executeOrchestrationRun(resumed.resumedTaskId!, "test-worker-resume");
    const child = await getBotTask(resumed.resumedTaskId!, viewer());
    expect(child.status).toBe("COMPLETED");
    expect(child.parentTaskId).toBe(waiting.id);
    expect(child.toolCalls[0]).toMatchObject({ tool: "terminal", decision: "allowed" });
    expect((await db.approvalRequest.findUniqueOrThrow({ where: { id: approval.id } })).status).toBe("approved");
  });

  it("an approval is stored and matched under the catalog tool name, not the runtime's mcp_<slug>_<tool> spelling", async () => {
    const server = await db.mcpServerRegistration.create({ data: {
      workspaceId: workspace.id, slug: "creative-provider", name: "Creative provider", url: "https://provider.example/mcp", enabled: true, status: "connected",
      tools: [{ name: "generate_video", readOnly: false, destructive: false }],
    } });
    const bot = await activeBot({}, [{ serverId: server.id, toolName: "generate_video", permission: "approval" }]);
    script.events = [...turn("plan").slice(0, 2), ...toolCall("mcp_creative_provider_generate_video")];
    const waiting = await runToEnd(bot.id, "Render the hook.");
    expect(waiting.status).toBe("WAITING");
    const approval = await db.approvalRequest.findFirstOrThrow({ where: { type: "bot_tool_call", status: "pending", payload: { path: ["runId"], equals: waiting.id } } });
    expect(approval.payload).toMatchObject({ serverId: server.id, tool: "generate_video", reportedTool: "mcp_creative_provider_generate_video", approvalKeys: [`${server.id}:generate_video`] });

    resetScript();
    script.events = [...toolCall("mcp_creative_provider_generate_video"), ...turn("rendered")];
    const resumed = await resolveBotTaskApproval(waiting.id, "approve", viewer());
    const run = await db.orchestrationRun.findUniqueOrThrow({ where: { id: resumed.resumedTaskId! } });
    expect((run.request as { approvedTools: string[] }).approvedTools).toEqual([`${server.id}:generate_video`]);
    await executeOrchestrationRun(resumed.resumedTaskId!, "test-worker-canonical");
    const child = await getBotTask(resumed.resumedTaskId!, viewer());
    // It runs: the approval was recognised, rather than bouncing back to WAITING for the same tool.
    expect(child.status).toBe("COMPLETED");
    expect(child.toolCalls[0]).toMatchObject({ tool: "mcp_creative_provider_generate_video", decision: "allowed" });
  });

  it("recognises an approval recorded before canonical names existed by resolving it against the catalog", async () => {
    const server = await db.mcpServerRegistration.create({ data: {
      workspaceId: workspace.id, slug: "legacy-provider", name: "Legacy provider", url: "https://legacy.example/mcp", enabled: true, status: "connected",
      tools: [{ name: "publish_post", readOnly: false, destructive: false }],
    } });
    const bot = await activeBot({}, [{ serverId: server.id, toolName: "publish_post", permission: "approval" }]);
    script.events = toolCall("mcp_legacy_provider_publish_post");
    const waiting = await runToEnd(bot.id, "Post it.");
    const approval = await db.approvalRequest.findFirstOrThrow({ where: { type: "bot_tool_call", status: "pending", payload: { path: ["runId"], equals: waiting.id } } });
    // Shape written by the previous release: the reported name only.
    await db.approvalRequest.update({ where: { id: approval.id }, data: { payload: { runId: waiting.id, botId: bot.id, serverId: server.id, tool: "mcp_legacy_provider_publish_post" } } });
    const resumed = await resolveBotTaskApproval(waiting.id, "approve", viewer());
    const run = await db.orchestrationRun.findUniqueOrThrow({ where: { id: resumed.resumedTaskId! } });
    expect((run.request as { approvedTools: string[] }).approvedTools).toEqual([`${server.id}:publish_post`]);
  });

  it("spends a one-use approval on its first call: the second invocation needs a fresh approval", async () => {
    const bot = await activeBot({}, [{ serverId: HERMES_BUILTIN_SERVER_ID, toolName: "terminal", permission: "approval" }]);
    script.events = toolCall("terminal");
    const waiting = await runToEnd(bot.id, "Build twice.");
    resetScript();
    // The resumed session calls the approved tool twice in one turn.
    script.events = [...toolCall("terminal"), ...toolCall("terminal"), ...turn("built twice").slice(1)];
    const resumed = await resolveBotTaskApproval(waiting.id, "approve", viewer());
    await executeOrchestrationRun(resumed.resumedTaskId!, "test-worker-oneuse");
    const child = await getBotTask(resumed.resumedTaskId!, viewer());

    expect(child.toolCalls.map((call) => call.decision)).toEqual(["allowed", "approval"]);
    expect(child.status).toBe("WAITING");
    expect(script.cancelled).toBe(1);                       // the second call was interrupted before it could run
    // ...and it asks again, as its own approval request.
    const again = await db.approvalRequest.findFirstOrThrow({ where: { type: "bot_tool_call", status: "pending", payload: { path: ["runId"], equals: child.id } } });
    expect(again.payload).toMatchObject({ tool: "terminal" });
  });

  it("does not park or release a task whose runtime would not confirm it stopped", async () => {
    const bot = await activeBot({}, [{ serverId: HERMES_BUILTIN_SERVER_ID, toolName: "terminal", permission: "approval" }]);
    script.events = [...turn("plan").slice(0, 2), ...toolCall("terminal")];
    script.cancelFailures = Infinity;
    const queued = await delegateToBot(bot.id, { task: "Run the build." }, asOwner());
    await executeOrchestrationRun(queued.id, "test-worker-unconfirmed");

    const task = await getBotTask(queued.id, viewer());
    expect(script.cancelled).toBe(3);                               // retried, then gave up
    expect(task.status).toBe("RUNNING");                            // still in flight, not WAITING / FAILED / CANCELLED
    expect(task.finishedAt).toBeNull();
    expect(task.waitingFor).toBeNull();
    expect(task.error).toMatch(/did not confirm/);
    expect(task.events.filter((event) => event.type === "approval_requested")).toHaveLength(0);
    expect(await db.approvalRequest.count({ where: { type: "bot_tool_call", payload: { path: ["runId"], equals: queued.id } } })).toBe(0);
    const attempt = await db.executionAttempt.findFirstOrThrow({ where: { orchestrationRunId: queued.id } });
    expect(attempt.status).toBe("running");
    expect(attempt.completedAt).toBeNull();
    // It keeps counting against the bot's concurrency, and its lease is still held.
    expect(await db.orchestrationRun.count({ where: { botId: bot.id, status: { in: ["queued", "running", "cancelling"] }, id: queued.id } })).toBe(1);
    expect((await redisKeys(`*orchestration:owner:${queued.id}`)).length).toBe(1);
    // A redelivered job must not turn it into a fabricated "cancelled".
    await executeOrchestrationRun(queued.id, "test-worker-redelivery").catch(() => undefined);
    expect((await getBotTask(queued.id, viewer())).status).toBe("RUNNING");
    // The user cannot cancel their way out of it either: it is already being cancelled.
    await expect(cancelBotTask(queued.id, viewer())).rejects.toThrow(/cannot be cancelled/);

    // The runtime still will not confirm: reconcile leaves it open and records the check.
    script.cancelFailures = Infinity;
    expect(await reconcileUnconfirmedInterruptions()).toMatchObject({ resolved: 0 });
    expect((await getBotTask(queued.id, viewer())).status).toBe("RUNNING");

    // Once the runtime confirms, the task becomes what it would have been: WAITING with its approval card.
    script.cancelFailures = 0;
    const outcome = await reconcileUnconfirmedInterruptions();
    expect(outcome.resolved).toBeGreaterThanOrEqual(1);
    const parked = await getBotTask(queued.id, viewer());
    expect(parked.status).toBe("WAITING");
    expect(parked.waitingFor?.tool).toBe("terminal");
    expect((await redisKeys(`*orchestration:owner:${queued.id}`)).length).toBe(0);
  });

  it("a cancel() that throws is unconfirmed too", async () => {
    const bot = await activeBot({}, [read("read_file")]);
    script.events = toolCall("terminal");
    script.cancelFailures = 1; script.cancelThrows = true;
    const queued = await delegateToBot(bot.id, { task: "Try a forbidden tool." }, asOwner());
    await executeOrchestrationRun(queued.id, "test-worker-throws");
    // The first cancel threw, the retry confirmed: halted normally, as a violation.
    const task = await getBotTask(queued.id, viewer());
    expect(task.status).toBe("FAILED");
    expect(task.error).toMatch(/policy_violation: terminal is not permitted/);
    expect(script.cancelled).toBe(2);
  });

  it("denying an approval closes the task", async () => {
    const bot = await activeBot({}, [{ serverId: HERMES_BUILTIN_SERVER_ID, toolName: "terminal", permission: "approval" }]);
    script.events = toolCall("terminal");
    const waiting = await runToEnd(bot.id);
    expect(await resolveBotTaskApproval(waiting.id, "deny", viewer())).toMatchObject({ status: "cancelled" });
    expect((await getBotTask(waiting.id, viewer())).status).toBe("CANCELLED");
  });

  it("does not accept a runtime-level approval request, since a bot runs unattended", async () => {
    const bot = await activeBot();
    script.events = [{ type: "approval_required", data: { command: "rm -rf /" } }];
    const task = await runToEnd(bot.id);
    expect(task.status).toBe("FAILED");
    expect(task.error).toMatch(/asked for approval/);
  });

  it("uses the bot's configured fallback only when the primary model is unavailable, and records it", async () => {
    const bot = await activeBot({ modelConfig: { primary: "gpt-5.6-luna", fallback: "gpt-5.6-terra" } });
    script.startErrors = [Object.assign(new Error("MODEL_UNAVAILABLE: no such model"), { code: "MODEL_UNAVAILABLE" })];
    script.events = turn("ok");
    const task = await runToEnd(bot.id);
    expect(task.status).toBe("COMPLETED");
    expect(script.startCalls.map((call) => (call.modelOverride as { model: string }).model)).toEqual(["gpt-5.6-luna", "gpt-5.6-terra"]);
    expect(task.events.find((event) => event.type === "model" && /fallback/.test(event.summary))).toBeTruthy();
  });

  it("fails cleanly (terminal, recorded) when the model is unavailable and there is no fallback", async () => {
    const bot = await activeBot({ modelConfig: { primary: "gpt-5.6-luna" } });
    script.startErrors = [Object.assign(new Error("MODEL_UNAVAILABLE: gone"), { code: "MODEL_UNAVAILABLE" })];
    const task = await runToEnd(bot.id);
    expect(task.status).toBe("FAILED");
    expect(task.error).toMatch(/MODEL_UNAVAILABLE/);
    expect(task.events.some((event) => event.type === "error")).toBe(true);
  });

  it("fails a task whose runtime output is empty rather than reporting success", async () => {
    const bot = await activeBot();
    script.events = [{ type: "completed", data: {} }];
    const task = await runToEnd(bot.id);
    expect(task.status).toBe("FAILED");
    expect(task.error).toMatch(/without output/);
  });

  it("reports a provider error the runtime narrates inside a normal-looking turn, instead of treating its text as the answer", async () => {
    const bot = await activeBot();
    script.events = [
      { type: "status", data: { kind: "lifecycle", text: "❌ OpenRouter rejected the request: HTTP 400: model is not a valid model ID" } },
      { type: "assistant_delta", data: { text: "Model 'x' isn't available on OpenRouter." } },
      { type: "completed", data: { text: "Model 'x' isn't available", error: "HTTP 400: model is not a valid model ID" } },
    ];
    const task = await runToEnd(bot.id);
    expect(task.status).toBe("FAILED");
    expect(task.error).toMatch(/The runtime reported an error: HTTP 400: model is not a valid model ID/);
  });

  it("a bot disabled after the task was queued fails without touching the runtime", async () => {
    const bot = await activeBot();
    const queued = await delegateToBot(bot.id, { task: "x task here" }, asOwner());
    await disableBot(bot.id, owner.id);
    await executeOrchestrationRun(queued.id, "test-worker-disabled");
    const task = await getBotTask(queued.id, viewer());
    expect(task.status).toBe("FAILED");
    expect(task.error).toMatch(/disabled/);
    expect(script.startCalls).toHaveLength(0);
  });

  it("test mode runs a draft bot, which delegation refuses", async () => {
    const draft = await createBot(botInput(workspace.id), owner.id);
    await expect(delegateToBot(draft.id, { task: "hello there" }, asOwner())).rejects.toThrow(/not active/);
    script.events = turn("hi");
    const queued = await delegateToBot(draft.id, { task: "hello there" }, asOwner(), { mode: "test" });
    await executeOrchestrationRun(queued.id, "test-worker-draft");
    const task = await getBotTask(queued.id, viewer());
    expect(task).toMatchObject({ status: "COMPLETED", mode: "test" });
  });

  it("never records reasoning: only status markers and events reach the log", async () => {
    const bot = await activeBot();
    script.events = [{ type: "status", data: { kind: "thinking" } }, ...turn("answer")];
    const task = await runToEnd(bot.id);
    expect(JSON.stringify(task.events)).not.toMatch(/reasoning|chain.of.thought/i);
  });
});

describe("delegation controls", () => {
  it("refuses callers outside allowedCallers and accepts listed agents and clients", async () => {
    const bot = await activeBot({ delegationPolicy: { allowedCallers: ["agent:hermes-lisa", "client:abc"], allowedChildBots: [], canDelegate: false, maxDepth: 1 } });
    await expect(delegateToBot(bot.id, { task: "please do a thing" }, asOwner())).rejects.toThrow(/not in this bot's allowed callers/);
    await expect(delegateToBot(bot.id, { task: "please do a thing" }, { kind: "agent", userId: owner.id, agentId: "hermes-nathan2" })).rejects.toThrow(/allowed callers/);
    const viaAgent = await delegateToBot(bot.id, { task: "please do a thing" }, { kind: "agent", userId: owner.id, agentId: "hermes-lisa" });
    expect(viaAgent.origin).toBe("agent:hermes-lisa");
    const viaClient = await delegateToBot(bot.id, { task: "please do a thing" }, { kind: "client", userId: owner.id, clientId: "abc" });
    expect(viaClient.origin).toBe("client:abc");
    const audit = await db.auditLog.findFirst({ where: { action: "bot.task.queued", entityId: viaAgent.id } });
    expect(audit).toMatchObject({ agentId: "hermes-lisa", actorType: "agent" });
  });

  it("hides a bot's existence from a user outside its workspace", async () => {
    const bot = await activeBot();
    const outsider = await db.user.create({ data: { email: `outsider-${Date.now()}@test.sentinel` } });
    await expect(delegateToBot(bot.id, { task: "please do a thing" }, { kind: "user", userId: outsider.id })).rejects.toThrow(/Bot not found/);
  });

  it("keeps a task inside the bot's workspace", async () => {
    const bot = await activeBot();
    const other = await makeWorkspace();
    const foreign = await db.project.create({ data: { name: "Foreign", userId: owner.id, workspaceId: other.workspace.id } });
    await expect(delegateToBot(bot.id, { task: "please do a thing", workspaceId: other.workspace.id }, asOwner())).rejects.toThrow(/not the bot's workspace/);
    await expect(delegateToBot(bot.id, { task: "please do a thing", projectId: foreign.id }, asOwner())).rejects.toThrow();
  });

  it("enforces the concurrency limit and the daily token budget", async () => {
    const bot = await activeBot({ limits: { maxConcurrentTasks: 1, maxTokensPerDay: 1000 } });
    await delegateToBot(bot.id, { task: "first task here" }, asOwner());
    await expect(delegateToBot(bot.id, { task: "second task here" }, asOwner())).rejects.toThrow(/concurrency limit/);

    const budgeted = await activeBot({ limits: { maxConcurrentTasks: 5, maxTokensPerDay: 1000 } });
    const spent = await db.orchestrationRun.create({ data: { userId: owner.id, workspaceId: workspace.id, botId: budgeted.id, request: { task: "old" }, status: "succeeded" } });
    await db.executionAttempt.create({ data: { orchestrationRunId: spent.id, attemptNumber: 1, agentId: HOST.agentId, adapterType: "hermes", usage: { totalTokens: 2500 } } });
    await expect(delegateToBot(budgeted.id, { task: "over budget now" }, asOwner())).rejects.toThrow(/daily token budget/);
  });

  it("is idempotent for a repeated key", async () => {
    const bot = await activeBot({ limits: { maxConcurrentTasks: 5 } });
    const a = await delegateToBot(bot.id, { task: "same request", idempotencyKey: "idem-key-0001" }, asOwner());
    const b = await delegateToBot(bot.id, { task: "same request", idempotencyKey: "idem-key-0001" }, asOwner());
    expect(b.id).toBe(a.id);
    expect(await db.orchestrationRun.count({ where: { botId: bot.id } })).toBe(1);
  });

  it("refuses when the host runtime cannot execute", async () => {
    const bot = await activeBot();
    script.verified = false;
    await expect(delegateToBot(bot.id, { task: "please do a thing" }, asOwner())).rejects.toThrow(/no verified execution contract/);
  });

  it("cancels a queued task (CANCELLED) and a waiting one", async () => {
    const bot = await activeBot({ limits: { maxConcurrentTasks: 5 } }, []);
    const queued = await delegateToBot(bot.id, { task: "cancel me please" }, asOwner());
    expect(await cancelBotTask(queued.id, viewer())).toMatchObject({ status: "cancelled", acknowledged: true });
    expect((await getBotTask(queued.id, viewer())).status).toBe("CANCELLED");
    await expect(cancelBotTask(queued.id, viewer())).rejects.toThrow(/cannot be cancelled/);
    // and the executor refuses to run something already cancelled
    await executeOrchestrationRun(queued.id, "test-worker-cancelled");
    expect(script.startCalls).toHaveLength(0);
  });

  it("a user removed from the workspace can no longer read their own task", async () => {
    const bot = await activeBot();
    const queued = await delegateToBot(bot.id, { task: "read me later" }, asOwner());
    const member = await db.user.create({ data: { email: `member-${Date.now()}@test.sentinel` } });
    await db.orchestrationRun.update({ where: { id: queued.id }, data: { userId: member.id } });
    await expect(getBotTask(queued.id, { userId: member.id, isAdmin: false })).rejects.toThrow(/Task not found/);
  });
});

describe("bot-to-bot delegation", () => {
  it("lets a running bot task delegate only to allowed child bots, records it on the parent, and blocks loops and depth", async () => {
    const child = await activeBot({ name: "Child", delegationPolicy: { allowedCallers: [], allowedChildBots: [], canDelegate: false, maxDepth: 1 } });
    const parent = await activeBot({ name: "Parent", delegationPolicy: { allowedCallers: ["user"], allowedChildBots: [child.id], canDelegate: true, maxDepth: 1 } });
    await db.bot.update({ where: { id: child.id }, data: { delegationPolicy: { allowedCallers: [`bot:${parent.id}`], allowedChildBots: [], canDelegate: false, maxDepth: 1 } } });

    const asBot = (botId: string): BotCaller => ({ kind: "bot", userId: owner.id, botId });
    const root = await delegateToBot(parent.id, { task: "coordinate the work" }, asOwner());
    // Not running yet: a queued task cannot delegate.
    await expect(delegateToBot(child.id, { task: "sub task please", parentTaskId: root.id }, asBot(parent.id))).rejects.toThrow(/not found or not running/);
    await db.orchestrationRun.update({ where: { id: root.id }, data: { status: "running" } });

    const sub = await delegateToBot(child.id, { task: "sub task please", parentTaskId: root.id }, asBot(parent.id));
    expect(sub).toMatchObject({ botId: child.id, parentTaskId: root.id, origin: `bot:${parent.id}` });
    expect((await getBotTask(root.id, viewer())).events.some((event) => event.type === "delegated" && event.data.childTaskId === sub.id)).toBe(true);

    // The child may not delegate onward (canDelegate false), nor back up the chain.
    await db.orchestrationRun.update({ where: { id: sub.id }, data: { status: "running" } });
    await db.bot.update({ where: { id: parent.id }, data: { delegationPolicy: { allowedCallers: ["user", `bot:${child.id}`], allowedChildBots: [child.id], canDelegate: true, maxDepth: 1 } } });
    await expect(delegateToBot(parent.id, { task: "loop back up", parentTaskId: sub.id }, asBot(child.id))).rejects.toThrow(/not permitted to delegate/);
    // A bot not on the parent's list is refused.
    const stranger = await activeBot({ name: "Stranger", delegationPolicy: { allowedCallers: [`bot:${parent.id}`], allowedChildBots: [], canDelegate: false, maxDepth: 1 } });
    await expect(delegateToBot(stranger.id, { task: "not my child", parentTaskId: root.id }, asBot(parent.id))).rejects.toThrow(/allowed child bots/);
  });

  it("does not let a caller borrow a running bot's identity by naming its task as parentTaskId", async () => {
    const child = await activeBot({ name: "Guarded child", delegationPolicy: { allowedCallers: [], allowedChildBots: [], canDelegate: false, maxDepth: 1 } });
    const parent = await activeBot({ name: "Delegating parent", delegationPolicy: { allowedCallers: ["user"], allowedChildBots: [child.id], canDelegate: true, maxDepth: 1 } });
    // The child accepts the parent bot as a caller and nobody else, including this user and this client.
    await db.bot.update({ where: { id: child.id }, data: { delegationPolicy: { allowedCallers: [`bot:${parent.id}`], allowedChildBots: [], canDelegate: false, maxDepth: 1 } } });
    const root = await delegateToBot(parent.id, { task: "coordinate the work" }, asOwner());
    await db.orchestrationRun.update({ where: { id: root.id }, data: { status: "running" } });
    const before = await db.orchestrationRun.count({ where: { botId: child.id } });

    const impostors: BotCaller[] = [
      asOwner(),
      { kind: "client", userId: owner.id, clientId: "mcp-client-1" },
      { kind: "agent", userId: owner.id, agentId: "hermes-lisa" },
      { kind: "bot", userId: owner.id, botId: child.id }, // a different bot cannot claim the parent's task either
    ];
    for (const impostor of impostors) {
      await expect(delegateToBot(child.id, { task: "sub task please", parentTaskId: root.id }, impostor), impostor.kind).rejects.toMatchObject({ status: 403 });
    }
    expect(await db.orchestrationRun.count({ where: { botId: child.id } })).toBe(before);

    // Without the borrowed lineage the same callers are judged as themselves, and refused by the child's own allowedCallers.
    await expect(delegateToBot(child.id, { task: "sub task please" }, asOwner())).rejects.toThrow(/not in this bot's allowed callers/);
    // Only the executing bot, authenticated as itself, is accepted.
    const sub = await delegateToBot(child.id, { task: "sub task please", parentTaskId: root.id }, { kind: "bot", userId: owner.id, botId: parent.id });
    expect(sub.origin).toBe(`bot:${parent.id}`);
  });

  it("a bot cannot be reached by an agent that is only allowed to reach a different bot", async () => {
    const a = await activeBot({ delegationPolicy: { allowedCallers: ["agent:hermes-lisa"], allowedChildBots: [], canDelegate: false, maxDepth: 1 } });
    const b = await activeBot({ delegationPolicy: { allowedCallers: ["agent:hermes-nathan2"], allowedChildBots: [], canDelegate: false, maxDepth: 1 } });
    const lisa: BotCaller = { kind: "agent", userId: owner.id, agentId: "hermes-lisa" };
    await expect(delegateToBot(b.id, { task: "not for lisa" }, lisa)).rejects.toThrow(/allowed callers/);
    await expect(delegateToBot(a.id, { task: "for lisa now" }, lisa)).resolves.toBeTruthy();
  });
});
