// The approval → continuation hand-off, and one-use tool permissions, under the conditions that broke them:
// simultaneous deciders, a queue that is down, a worker that is quick, and a permission spent in one task being
// offered again to the next. Real executor, real database, scripted runtime.
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { HOST, resetScript, script, toolCall, turn } from "./fake-runtime";

vi.mock("@/lib/agents/runtime/service", async () => (await import("./fake-runtime")).serviceMock);
vi.mock("@/lib/orchestration/queue", () => ({ enqueueOrchestrationRun: vi.fn().mockResolvedValue(undefined) }));

import { db } from "@/lib/db";
import { executeOrchestrationRun } from "@/lib/orchestration/executor";
import { enqueueOrchestrationRun } from "@/lib/orchestration/queue";
import { HERMES_BUILTIN_SERVER_ID } from "@/lib/bots/catalog";
import { loadBotExecution } from "@/lib/bots/execution";
import { createBot, type BotRecord } from "@/lib/bots/service";
import { BotTaskError, delegateToBot, getBotTask, resolveBotTaskApproval, retryBotContinuations, cancelBotTask } from "@/lib/bots/tasks";
import { ApprovalAlreadyDecidedError, decideApproval, createApproval } from "@/lib/workspaces/approvals";
import type { CreateBotInput, GrantToolInput } from "@/lib/bots/schema";
import { botInput, makeWorkspace } from "./fixtures";

const enqueue = vi.mocked(enqueueOrchestrationRun);
let owner: { id: string }; let workspace: { id: string };
const viewer = () => ({ userId: owner.id, isAdmin: true as const });
const approvalGrant = (toolName: string): GrantToolInput => ({ serverId: HERMES_BUILTIN_SERVER_ID, toolName, permission: "approval" });
const key = (toolName: string) => `${HERMES_BUILTIN_SERVER_ID}:${toolName}`;

beforeAll(async () => { ({ owner, workspace } = await makeWorkspace()); });
beforeEach(() => { resetScript(); enqueue.mockReset(); enqueue.mockResolvedValue(undefined); process.env.SENTINEL_INTERRUPT_RETRY_MS = "0"; });

async function activeBot(grants: GrantToolInput[], over: Partial<CreateBotInput> = {}): Promise<BotRecord> {
  return createBot(botInput(workspace.id, { status: "active", systemPrompt: "Be terse.", ...over }), owner.id, { toolGrants: grants });
}
async function run(botId: string, task = "Do the work.") {
  const queued = await delegateToBot(botId, { task }, { kind: "user", userId: owner.id });
  await executeOrchestrationRun(queued.id, `w-${queued.id}`);
  return getBotTask(queued.id, viewer());
}
const pendingApproval = (runId: string) => db.approvalRequest.findFirstOrThrow({ where: { type: "bot_tool_call", status: "pending", payload: { path: ["runId"], equals: runId } } });
const children = (runId: string) => db.orchestrationRun.findMany({ where: { parentRunId: runId } });
const grantKeys = async (runId: string, spent?: boolean) =>
  (await db.botToolGrant.findMany({ where: { runId, ...(spent === undefined ? {} : { consumedAt: spent ? { not: null } : null }) }, orderBy: { key: "asc" } })).map((grant) => grant.key);

async function waitingOn(tool: string) {
  const bot = await activeBot([approvalGrant(tool)]);
  script.events = toolCall(tool);
  const waiting = await run(bot.id);
  expect(waiting.status).toBe("WAITING");
  return { bot, waiting, approval: await pendingApproval(waiting.id) };
}

describe("deciding an approval is atomic with creating its continuation", () => {
  it("simultaneous approve/approve: one decision wins, one continuation exists, one enqueue happens", async () => {
    for (let round = 0; round < 3; round += 1) {
      const { waiting, approval } = await waitingOn("terminal");
      enqueue.mockClear();
      const outcomes = await Promise.allSettled([
        resolveBotTaskApproval(waiting.id, "approve", viewer()),
        resolveBotTaskApproval(waiting.id, "approve", viewer()),
        resolveBotTaskApproval(waiting.id, "approve", viewer()),
      ]);
      const won = outcomes.filter((outcome) => outcome.status === "fulfilled");
      const lost = outcomes.filter((outcome): outcome is PromiseRejectedResult => outcome.status === "rejected");
      expect(won).toHaveLength(1);
      for (const loser of lost) expect(loser.reason).toBeInstanceOf(BotTaskError);
      expect(await children(waiting.id)).toHaveLength(1);
      expect((await db.approvalRequest.findUniqueOrThrow({ where: { id: approval.id } })).status).toBe("approved");
      expect(await db.auditLog.count({ where: { approvalRequestId: approval.id, action: { startsWith: "approval." }, NOT: { action: "approval.requested" } } })).toBe(1);
      expect(enqueue).toHaveBeenCalledTimes(1);
    }
  });

  it("simultaneous approve/deny: exactly one wins, and a continuation exists only if the approval was approved", async () => {
    const seen = new Set<string>();
    for (let round = 0; round < 6; round += 1) {
      const { waiting, approval } = await waitingOn("terminal");
      await Promise.allSettled([
        resolveBotTaskApproval(waiting.id, "approve", viewer()),
        resolveBotTaskApproval(waiting.id, "deny", viewer()),
      ]);
      const status = (await db.approvalRequest.findUniqueOrThrow({ where: { id: approval.id } })).status;
      seen.add(status);
      const kids = await children(waiting.id);
      expect(kids).toHaveLength(status === "approved" ? 1 : 0);
      expect(["approved", "rejected"]).toContain(status);
      expect((await db.orchestrationRun.findUniqueOrThrow({ where: { id: waiting.id } })).status).toBe("cancelled");
      // A denial must never leave an executable child behind.
      if (status === "rejected") expect(await db.orchestrationRun.count({ where: { parentRunId: waiting.id } })).toBe(0);
    }
    expect(seen.size).toBeGreaterThan(0);
  });

  it("a continuation is not visible to the queue until the decision has committed, and is committed with it", async () => {
    const { waiting, approval } = await waitingOn("terminal");
    let atEnqueue: { approval: string; child: string | null; parent: string } | null = null;
    enqueue.mockImplementation(async (runId: string) => {
      // What a worker that picked the job up this instant would see.
      atEnqueue = {
        approval: (await db.approvalRequest.findUniqueOrThrow({ where: { id: approval.id } })).status,
        child: (await db.orchestrationRun.findUnique({ where: { id: runId } }))?.status ?? null,
        parent: (await db.orchestrationRun.findUniqueOrThrow({ where: { id: waiting.id } })).status,
      };
    });
    const resumed = await resolveBotTaskApproval(waiting.id, "approve", viewer());
    expect(atEnqueue).toEqual({ approval: "approved", child: "queued", parent: "cancelled" });
    expect(enqueue).toHaveBeenCalledWith(resumed.resumedTaskId);
  });

  it("a refusal before the decision (bot disabled) changes nothing: still pending, still waiting, nothing created", async () => {
    const { bot, waiting, approval } = await waitingOn("terminal");
    await db.bot.update({ where: { id: bot.id }, data: { status: "disabled" } });
    enqueue.mockClear();
    await expect(resolveBotTaskApproval(waiting.id, "approve", viewer())).rejects.toBeInstanceOf(BotTaskError);
    expect((await db.approvalRequest.findUniqueOrThrow({ where: { id: approval.id } })).status).toBe("pending");
    expect((await db.orchestrationRun.findUniqueOrThrow({ where: { id: waiting.id } })).status).toBe("waiting");
    expect(await children(waiting.id)).toHaveLength(0);
    expect(enqueue).not.toHaveBeenCalled();
  });

  it("when the queue is down the approval is still decided, the child stays queued with a durable marker, and nothing runs", async () => {
    const { waiting, approval } = await waitingOn("terminal");
    enqueue.mockRejectedValue(new Error("redis unavailable"));
    const resumed = await resolveBotTaskApproval(waiting.id, "approve", viewer());
    expect(resumed).toMatchObject({ status: "resumed", enqueued: false });
    expect((resumed as { warning?: string }).warning).toMatch(/redis unavailable/);

    const decided = await db.approvalRequest.findUniqueOrThrow({ where: { id: approval.id } });
    expect(decided.status).toBe("approved");
    expect(decided.payload).toMatchObject({ continuation: { runId: resumed.resumedTaskId, pendingEnqueue: true } });
    const child = await db.orchestrationRun.findUniqueOrThrow({ where: { id: resumed.resumedTaskId! } });
    expect(child.status).toBe("queued");
    expect(await db.executionAttempt.count({ where: { orchestrationRunId: child.id } })).toBe(0);   // nothing started

    // Queue back: the sweep puts it on the queue once; sweeping again is a no-op.
    enqueue.mockReset(); enqueue.mockResolvedValue(undefined);
    expect(await retryBotContinuations()).toMatchObject({ enqueued: 1, failed: 0 });
    expect(enqueue).toHaveBeenCalledWith(child.id);
    expect((await db.approvalRequest.findUniqueOrThrow({ where: { id: approval.id } })).payload).toMatchObject({ continuation: { pendingEnqueue: false } });
    enqueue.mockClear();
    expect(await retryBotContinuations()).toMatchObject({ enqueued: 0 });
    expect(enqueue).not.toHaveBeenCalled();
    await executeOrchestrationRun(child.id, "w-after-outage");   // and it does run, once queued
    expect((await db.orchestrationRun.findUniqueOrThrow({ where: { id: child.id } })).status).not.toBe("queued");
  });

  it("repeating the approve after an enqueue failure re-queues instead of reporting 'not waiting'", async () => {
    const { waiting } = await waitingOn("terminal");
    enqueue.mockRejectedValueOnce(new Error("redis unavailable"));
    const first = await resolveBotTaskApproval(waiting.id, "approve", viewer());
    const again = await resolveBotTaskApproval(waiting.id, "approve", viewer());
    expect(again).toMatchObject({ status: "resumed", resumedTaskId: first.resumedTaskId, enqueued: true });
    expect(await children(waiting.id)).toHaveLength(1);
    await expect(resolveBotTaskApproval(waiting.id, "approve", viewer())).rejects.toMatchObject({ status: 404 });
  });

  it("a continuation cancelled before its retry is settled, never enqueued", async () => {
    const { waiting } = await waitingOn("terminal");
    enqueue.mockRejectedValueOnce(new Error("redis unavailable"));
    const resumed = await resolveBotTaskApproval(waiting.id, "approve", viewer());
    await cancelBotTask(resumed.resumedTaskId!, viewer());
    enqueue.mockClear();
    expect(await retryBotContinuations()).toMatchObject({ settled: 1, enqueued: 0 });
    expect(enqueue).not.toHaveBeenCalled();
  });

  it("cancelling a waiting task that was just approved cannot cancel the continuation's parent twice or revive anything", async () => {
    const { waiting } = await waitingOn("terminal");
    await resolveBotTaskApproval(waiting.id, "approve", viewer());
    await expect(cancelBotTask(waiting.id, viewer())).rejects.toBeInstanceOf(BotTaskError);
  });

  it("decideApproval itself: two simultaneous deciders, one winner, one audit row", async () => {
    const approval = await createApproval({ workspaceId: workspace.id, title: "Generic approval" }, owner.id);
    const outcomes = await Promise.allSettled([
      decideApproval(approval.id, "approved", owner.id),
      decideApproval(approval.id, "rejected", owner.id),
      decideApproval(approval.id, "approved", owner.id),
    ]);
    expect(outcomes.filter((outcome) => outcome.status === "fulfilled")).toHaveLength(1);
    for (const outcome of outcomes) if (outcome.status === "rejected") expect(outcome.reason).toBeInstanceOf(ApprovalAlreadyDecidedError);
    const final = await db.approvalRequest.findUniqueOrThrow({ where: { id: approval.id } });
    expect(await db.auditLog.count({ where: { approvalRequestId: approval.id, action: { in: ["approval.approved", "approval.rejected"] } } })).toBe(1);
    expect(["approved", "rejected"]).toContain(final.status);
  });
});

describe("a one-use tool permission stays one-use across tasks", () => {
  it("approve A → use A → wait for B → approve B: A needs a fresh approval", async () => {
    const bot = await activeBot([approvalGrant("terminal"), approvalGrant("write_file")]);
    script.events = toolCall("terminal");
    const first = await run(bot.id);                                     // waits for A (terminal)
    expect(first.waitingFor?.tool).toBe("terminal");

    resetScript();
    script.events = [...toolCall("terminal"), ...toolCall("write_file")];   // uses A, then needs B
    const approveA = await resolveBotTaskApproval(first.id, "approve", viewer());
    expect(await grantKeys(approveA.resumedTaskId!)).toEqual([key("terminal")]);
    await executeOrchestrationRun(approveA.resumedTaskId!, "w-a");
    const second = await getBotTask(approveA.resumedTaskId!, viewer());
    expect(second.status).toBe("WAITING");
    expect(second.toolCalls.map((call) => `${call.tool}:${call.decision}`)).toEqual(["terminal:allowed", "write_file:approval"]);
    expect(await grantKeys(second.id, true)).toEqual([key("terminal")]);    // A is recorded as spent, in the database

    resetScript();
    script.events = [...toolCall("write_file"), ...toolCall("terminal")];   // B is now fine; A is asked for again
    const approveB = await resolveBotTaskApproval(second.id, "approve", viewer());
    // The continuation carries B only. A was spent; the first request's approvedTools no longer decides anything.
    expect(await grantKeys(approveB.resumedTaskId!)).toEqual([key("write_file")]);
    expect((await db.orchestrationRun.findUniqueOrThrow({ where: { id: approveB.resumedTaskId! } })).request).toMatchObject({ approvedTools: [key("write_file")] });
    await executeOrchestrationRun(approveB.resumedTaskId!, "w-b");
    const third = await getBotTask(approveB.resumedTaskId!, viewer());
    expect(third.toolCalls.map((call) => `${call.tool}:${call.decision}`)).toEqual(["write_file:allowed", "terminal:approval"]);
    expect(third.status).toBe("WAITING");
    expect((await pendingApproval(third.id)).payload).toMatchObject({ tool: "terminal" });
  });

  it("an unspent permission IS carried forward (approved but never used), and only once", async () => {
    const bot = await activeBot([approvalGrant("terminal"), approvalGrant("write_file")]);
    script.events = toolCall("terminal");
    const first = await run(bot.id);
    resetScript();
    script.events = toolCall("write_file");                              // does not use terminal; asks for write_file
    const approveA = await resolveBotTaskApproval(first.id, "approve", viewer());
    await executeOrchestrationRun(approveA.resumedTaskId!, "w-unused");
    const second = await getBotTask(approveA.resumedTaskId!, viewer());
    expect(second.status).toBe("WAITING");
    expect(await grantKeys(second.id, false)).toEqual([key("terminal")]);
    const approveB = await resolveBotTaskApproval(second.id, "approve", viewer());
    expect(await grantKeys(approveB.resumedTaskId!)).toEqual([key("terminal"), key("write_file")]);
    expect((await db.botToolGrant.findMany({ where: { runId: approveB.resumedTaskId! }, orderBy: { key: "asc" } })).map((grant) => grant.sourceRunId)).toEqual([second.id, null]);
  });

  it("spending is durable and concurrent-safe: two calls that resolve to the same approved tool admit exactly one", async () => {
    const server = await db.mcpServerRegistration.create({ data: {
      workspaceId: workspace.id, slug: "twin-provider", name: "Twin provider", url: "https://twin.example/mcp", enabled: true, status: "connected",
      tools: [{ name: "generate_video", readOnly: false, destructive: false }],
    } });
    const bot = await activeBot([{ serverId: server.id, toolName: "generate_video", permission: "approval" }]);
    const queued = await delegateToBot(bot.id, { task: "Render." }, { kind: "user", userId: owner.id }, { approvedTools: [`${server.id}:generate_video`] });
    const row = await db.orchestrationRun.findUniqueOrThrow({ where: { id: queued.id } });
    const execution = (await loadBotExecution(row))!;
    const started = (name: string) => ({ type: "tool_started", sessionId: "s", sequence: 1, timestamp: "", data: { name } }) as never;

    const verdicts = await Promise.all([
      execution.observe(started("generate_video")),
      execution.observe(started("mcp_twin_provider_generate_video")),
    ]);
    expect(verdicts.filter((verdict) => verdict === null)).toHaveLength(1);         // one admitted
    expect(verdicts.filter((verdict) => verdict?.kind === "approval")).toHaveLength(1);   // the other must ask again
    expect(await grantKeys(row.id, true)).toEqual([`${server.id}:generate_video`]);

    // A second executor for the same run (a restart, a redelivery) finds nothing left to spend.
    const reloaded = (await loadBotExecution(row))!;
    expect((await reloaded.observe(started("generate_video")))?.kind).toBe("approval");
  });

  it("a run queued by the previous release (approvedTools only, no rows) is honoured once, and a reload does not resurrect it", async () => {
    const bot = await activeBot([approvalGrant("terminal")]);
    const queued = await delegateToBot(bot.id, { task: "Legacy." }, { kind: "user", userId: owner.id });
    await db.orchestrationRun.update({ where: { id: queued.id }, data: { request: { task: "Legacy.", modelRole: "primary", mode: "delegate", approvedTools: [key("terminal")] } } });
    expect(await grantKeys(queued.id)).toEqual([]);
    const row = await db.orchestrationRun.findUniqueOrThrow({ where: { id: queued.id } });
    const started = { type: "tool_started", sessionId: "s", sequence: 1, timestamp: "", data: { name: "terminal" } } as never;
    expect(await (await loadBotExecution(row))!.observe(started)).toBeNull();
    expect(await grantKeys(row.id, true)).toEqual([key("terminal")]);
    expect((await (await loadBotExecution(row))!.observe(started))?.kind).toBe("approval");
  });

  it("a legacy waiting parent contributes nothing from its old approvedTools: fail closed", async () => {
    const { waiting } = await waitingOn("terminal");
    await db.orchestrationRun.update({ where: { id: waiting.id }, data: { request: { task: "Do the work.", modelRole: "primary", mode: "delegate", approvedTools: [key("write_file")] } } });
    const resumed = await resolveBotTaskApproval(waiting.id, "approve", viewer());
    expect(await grantKeys(resumed.resumedTaskId!)).toEqual([key("terminal")]);
  });

  it("refuses an old approval whose reported name could be either of two servers' tools, leaving it pending", async () => {
    const make = (slug: string) => db.mcpServerRegistration.create({ data: {
      workspaceId: workspace.id, slug, name: slug, url: `https://${slug}.example/mcp`, enabled: true, status: "connected",
      tools: [{ name: "publish", readOnly: false, destructive: false }],
    } });
    const [one, two] = [await make("amb-one"), await make("amb-two")];
    const bot = await activeBot([{ serverId: one.id, toolName: "publish", permission: "approval" }, { serverId: two.id, toolName: "publish", permission: "approval" }]);
    script.events = toolCall("publish");
    const waiting = await run(bot.id);
    const approval = await pendingApproval(waiting.id);
    await db.approvalRequest.update({ where: { id: approval.id }, data: { payload: { runId: waiting.id, botId: bot.id, tool: "publish" } } });
    await expect(resolveBotTaskApproval(waiting.id, "approve", viewer())).rejects.toMatchObject({ status: 409 });
    expect((await db.approvalRequest.findUniqueOrThrow({ where: { id: approval.id } })).status).toBe("pending");
    expect((await db.orchestrationRun.findUniqueOrThrow({ where: { id: waiting.id } })).status).toBe("waiting");
    expect(await children(waiting.id)).toHaveLength(0);
  });

  it("only a bot-tool approval of this task's workspace and run can be resolved through it", async () => {
    const { waiting, approval } = await waitingOn("terminal");
    await db.approvalRequest.update({ where: { id: approval.id }, data: { type: "organization_change" } });
    await expect(resolveBotTaskApproval(waiting.id, "approve", viewer())).rejects.toMatchObject({ status: 404 });
  });
});

describe("approval wording does not claim pre-execution enforcement", () => {
  it("says the tool may already have begun, and not that the task stopped before it", async () => {
    const { approval, waiting } = await waitingOn("terminal");
    expect(approval.description).toMatch(/may already have begun/);
    expect(approval.description).not.toMatch(/stopped before/i);
    expect(waiting.events.find((event) => event.type === "approval_requested")?.summary).not.toMatch(/before/i);
  });
});

void HOST; void turn;
