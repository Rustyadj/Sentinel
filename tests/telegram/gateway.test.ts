import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const fake = vi.hoisted(() => ({ executions: 0, effects: 0, tool: "", queueDown: false, sendMode: "ok", gateMissing: false, sent: [] as Record<string, unknown>[], starts: [] as Record<string, unknown>[] }));
vi.mock("@/lib/agents/runtime/service", () => {
  const host = (id: string) => ({ id: `runtime-${id}`, agentId: id, kind: "hermes", transport: "http", endpoint: "http://127.0.0.1:1", enabled: true, executionVerified: true, capabilities: {}, sentinelControl: "partial", args: [] });
  const adapter = {
    readiness: async () => ({ ready: true }),
    startSession: async (input: Record<string, unknown>) => { fake.starts.push(input); return { id: `tg-session-${crypto.randomUUID()}`, metadata: fake.gateMissing ? {} : { toolGate: "pre-execution", sessionSource: `sentinel-telegram:${input.telegramUpdateId}` } }; },
    cancel: async () => ({ success: true }),
    send: async function* (input: { sessionId: string; authorizeTool: (ask: unknown) => Promise<{ allow: boolean }> }) {
      fake.executions += 1;
      if (fake.tool) {
        const verdict = await input.authorizeTool({ kind: "pre-execution", tool: fake.tool, requestId: crypto.randomUUID(), description: "test call" });
        if (verdict.allow) { fake.effects += 1; yield { type: "tool_started", data: { name: fake.tool, phase: "tool.start" } }; }
      }
      yield { type: "assistant_delta", data: { text: "A governed reply." } };
      yield { type: "completed", data: {} };
    },
  };
  return { getRuntimeView: async (id: string) => host(id), listRuntimeViews: async () => [host("hermes-lisa"), host("hermes-nathan2")], getAdapterForRuntime: async (id: string) => ({ runtime: host(id), adapter }), getRuntimeAdapter: () => adapter };
});
vi.mock("@/lib/orchestration/queue", () => ({ enqueueOrchestrationRun: vi.fn(async () => { if (fake.queueDown) throw new Error("test queue unavailable"); }) }));
vi.mock("@/lib/telegram/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/telegram/client")>();
  return { ...actual, downloadFile: vi.fn(async () => new Uint8Array([1, 2, 3])), telegramCall: vi.fn(async (_token: string, method: string, body: Record<string, unknown>) => {
    fake.sent.push({ method, ...body });
    if (fake.sendMode === "429") throw new actual.TelegramApiError("telegram_rate_limited", 1);
    if (fake.sendMode === "unknown") throw new actual.TelegramApiError("telegram_transport_unknown", null, true);
    return { message_id: 987 };
  }) };
});

import { db } from "@/lib/db";
import { createBot, type BotRecord } from "@/lib/bots/service";
import { receiveUpdate, sweepTelegram, deliverPending, submitConversationTurn } from "@/lib/telegram/service";
import { expectedAgent, validSecret, chunks, updateSchema } from "@/lib/telegram/policy";
import { POST } from "@/app/api/telegram/webhooks/[key]/route";
import { executeOrchestrationRun } from "@/lib/orchestration/executor";
import { enqueueOrchestrationRun } from "@/lib/orchestration/queue";
import { resolveBotTaskApproval } from "@/lib/bots/tasks";
import type { TelegramBot } from "@prisma/client";

let binding: TelegramBot; let bot: BotRecord; let owner: { id: string }; let workspace: { id: string }; let mediaRoot: string;
let counter = 0;
function message(text = "Hello", sender = 101, updateId = ++counter) { return { update_id: updateId, message: { message_id: updateId, from: { id: sender, is_bot: false }, chat: { id: sender, type: "private" }, text } }; }
beforeEach(async () => {
  fake.executions = 0; fake.effects = 0; fake.tool = ""; fake.queueDown = false; fake.sendMode = "ok"; fake.gateMissing = false; fake.sent = []; fake.starts = [];
  // The database is disposable and dedicated to this invocation.
  await db.telegramDelivery.deleteMany(); await db.telegramUpdate.deleteMany(); await db.telegramConversation.deleteMany(); await db.telegramAccess.deleteMany(); await db.telegramBot.deleteMany();
  owner = await db.user.create({ data: { email: `tg-${crypto.randomUUID()}@test.sentinel` } });
  workspace = await db.workspace.create({ data: { slug: `tg-${crypto.randomUUID()}`, name: "Telegram test", ownerId: owner.id } });
  bot = await createBot({ workspaceId: workspace.id, runtimeAgentId: "hermes-lisa", name: "Lisa", role: "Existing agent", status: "active", memoryPolicy: { enabled: false } }, owner.id);
  binding = await db.telegramBot.create({ data: { key: "lisa", telegramBotId: "777", agentId: "hermes-lisa", botId: bot.id, workspaceId: workspace.id, tokenEnvVar: "TELEGRAM_LISA_BOT_TOKEN", webhookSecretEnvVar: "TELEGRAM_LISA_WEBHOOK_SECRET", enabled: true, cutoverVerifiedAt: new Date() } });
  await db.telegramAccess.create({ data: { telegramBotId: binding.id, senderId: "101", chatId: "101", userId: owner.id } });
  process.env.TELEGRAM_GATEWAY_ENABLED = "true"; process.env.TELEGRAM_WEBHOOKS_ENABLED = "true";
  process.env.TELEGRAM_LISA_BOT_TOKEN = "test-only-not-a-real-token"; process.env.TELEGRAM_LISA_WEBHOOK_SECRET = "test_secret_1234567890123456789";
  mediaRoot = await mkdtemp(join(tmpdir(), "sentinel-tg-test-")); process.env.TELEGRAM_MEDIA_ROOT = mediaRoot;
});
afterAll(async () => { if (mediaRoot) await rm(mediaRoot, { recursive: true, force: true }); });
const row = (id: string) => db.telegramUpdate.findUniqueOrThrow({ where: { id } });
async function received(raw = message()) { return receiveUpdate(binding, raw); }
async function execute(id: string) { await sweepTelegram(); const update = await row(id); await executeOrchestrationRun(update.taskId!, `tg-test-${id}`); await sweepTelegram(); return row(id); }

describe("Telegram gateway authentication and routing", () => {
  it("rejects invalid webhook secrets before reading or storing a message", async () => {
    const response = await POST(new Request("http://x", { method: "POST", headers: { "x-telegram-bot-api-secret-token": "wrong" }, body: JSON.stringify(message()) }), { params: Promise.resolve({ key: "lisa" }) });
    expect(response.status).toBe(401); expect(await db.telegramUpdate.count()).toBe(0);
  });
  it("rejects unauthorized senders, forged agents, bot identities, and non-private chats", async () => {
    await expect(received(message("attack", 202))).rejects.toMatchObject({ code: "sender_not_authorized" });
    expect(() => expectedAgent("lisa", "hermes-nathan2")).toThrow();
    const raw = message(); raw.message.from.is_bot = true;
    expect(updateSchema.safeParse(raw).success).toBe(false);
    const forged = await received({ ...message(), agentId: "hermes-nathan2", parentTaskId: "forged" } as ReturnType<typeof message>);
    await sweepTelegram();
    const task = await db.orchestrationRun.findUniqueOrThrow({ where: { id: (await row(forged)).taskId! } });
    expect(task.parentRunId).toBeNull(); expect(task.resolvedAgentId).toBe("hermes-lisa");
  });
  it("Lisa routes exclusively to Lisa, and duplicate updates execute once", async () => {
    const raw = message(); const ids = await Promise.all([received(raw), received(raw), received(raw)]);
    expect(new Set(ids).size).toBe(1);
    await Promise.all([sweepTelegram(), sweepTelegram()]);
    expect(await db.orchestrationRun.count({ where: { botId: bot.id } })).toBe(1);
    const done = await execute(ids[0]); expect(done.status).toBe("succeeded"); expect(fake.executions).toBe(1);
    await received(raw); await sweepTelegram(); expect(fake.executions).toBe(1);
    expect(fake.starts[0]).toMatchObject({ runtimeId: "runtime-hermes-lisa", toolGate: "telegram", telegramUpdateId: ids[0] });
  });
  it("serializes distinct updates with identical timestamps while a queue enqueue is pending", async () => {
    const one = await received(); const two = await received();
    await db.telegramUpdate.updateMany({ data: { receivedAt: new Date("2026-10-17T00:00:00Z") } });
    fake.queueDown = true; await Promise.all([sweepTelegram(), sweepTelegram()]);
    expect(await db.orchestrationRun.count({ where: { botId: bot.id } })).toBe(1);
    expect([await row(one), await row(two)].filter((u) => u.taskId)).toHaveLength(1);
  });
  it("Nathan2 routes exclusively to Nathan2 without borrowing Lisa credentials or identity", async () => {
    const nathan = await createBot({ workspaceId: workspace.id, runtimeAgentId: "hermes-nathan2", name: "Nathan2", role: "Existing agent", status: "active", memoryPolicy: { enabled: false } }, owner.id);
    const b = await db.telegramBot.create({ data: { key: "nathan2", telegramBotId: "778", agentId: "hermes-nathan2", botId: nathan.id, workspaceId: workspace.id, tokenEnvVar: "TELEGRAM_NATHAN2_BOT_TOKEN", webhookSecretEnvVar: "TELEGRAM_NATHAN2_WEBHOOK_SECRET", enabled: true, cutoverVerifiedAt: new Date() } });
    await db.telegramAccess.create({ data: { telegramBotId: b.id, senderId: "101", chatId: "101", userId: owner.id } });
    const id = await receiveUpdate(b, message()); await sweepTelegram();
    const task = await db.orchestrationRun.findUniqueOrThrow({ where: { id: (await row(id)).taskId! } });
    expect(task.botId).toBe(nathan.id); expect(task.resolvedAgentId).toBe("hermes-nathan2");
  });
  it("acknowledges a durable inbox even while Redis is down, then recovers the same task", async () => {
    fake.queueDown = true; const id = await received(); await sweepTelegram(); const pending = await row(id);
    expect(pending.status).toBe("pending"); expect(pending.taskId).toBeTruthy();
    fake.queueDown = false; await sweepTelegram(); expect((await row(id)).taskId).toBe(pending.taskId);
    expect(await db.orchestrationRun.count({ where: { botId: bot.id } })).toBe(1);
    expect(enqueueOrchestrationRun).toHaveBeenCalledWith(pending.taskId);
  });
  it("stores voice/photo/document metadata and stages attachments without token URLs", async () => {
    const raw = message(); const id = await received({ ...raw, message: { ...raw.message, voice: { file_id: "voice" }, photo: [{ file_id: "photo" }], document: { file_id: "doc", file_name: "../../brief.txt" } } } as ReturnType<typeof message>);
    await sweepTelegram(); const update = await row(id); expect(update.mediaPaths).toHaveLength(3);
    const task = await db.orchestrationRun.findUniqueOrThrow({ where: { id: update.taskId! } });
    expect(JSON.stringify(task.request)).toContain(`/sentinel-media/${id}/`); expect(JSON.stringify(task.request)).not.toContain(process.env.TELEGRAM_LISA_BOT_TOKEN);
  });
});

describe("governed execution, continuity and delivery", () => {
  it("does not submit a model prompt if trusted session gate metadata is missing", async () => {
    fake.gateMissing = true; const id = await received(); const done = await execute(id);
    expect(done.status).toBe("failed"); expect(fake.executions).toBe(0); expect(fake.effects).toBe(0);
  });
  it("denies an ungranted tool before its fake side effect and records the failure", async () => {
    fake.tool = "web_search"; const id = await received(); const done = await execute(id);
    expect(fake.effects).toBe(0); expect(done.status).toBe("failed");
    expect(await db.botRunEvent.count({ where: { runId: done.taskId!, type: "tool_denied" } })).toBeGreaterThan(0);
  });
  it("preserves one-use approvals, channel lineage and replay protection", async () => {
    await db.botToolPermission.create({ data: { botId: bot.id, serverId: "hermes-builtin", toolName: "web_search", permission: "approval" } });
    fake.tool = "web_search"; const id = await received(); const waiting = await execute(id); expect(waiting.status).toBe("active"); expect(fake.effects).toBe(0);
    const continued = await resolveBotTaskApproval(waiting.taskId!, "approve", { userId: owner.id, isAdmin: true });
    await expect(resolveBotTaskApproval(waiting.taskId!, "approve", { userId: owner.id, isAdmin: true })).rejects.toThrow();
    const continuation = await db.orchestrationRun.findUniqueOrThrow({ where: { id: continued.resumedTaskId! } });
    expect((continuation.request as { channel: { updateId: string } }).channel.updateId).toBe(id);
    await executeOrchestrationRun(continuation.id, `tg-approved-${id}`); await sweepTelegram();
    expect(fake.effects).toBe(1); expect((await row(id)).currentTaskId).toBe(continuation.id);
  });
  it("persists the shared UI conversation and sends only to the originating Telegram chat", async () => {
    const id = await received(); const done = await execute(id); expect(done.chatRoomId).toBeTruthy();
    const messages = await db.message.findMany({ where: { chatRoomId: done.chatRoomId! } });
    expect(messages.map((m) => m.role)).toEqual(["user", "agent"]);
    expect(fake.sent.find((s) => s.method === "sendMessage")).toMatchObject({ chat_id: "101", reply_parameters: { message_id: Number(done.messageId) } });
    await db.$disconnect(); expect((await db.message.findMany({ where: { chatRoomId: done.chatRoomId! } })).length).toBe(2);
    const conversation = await db.telegramConversation.findUniqueOrThrow({ where: { chatRoomId: done.chatRoomId! } });
    const followup = await submitConversationTurn(conversation.id, owner.id, "Continue", "ui-request-0001");
    await sweepTelegram(); expect((await row(followup.id)).chatRoomId).toBe(done.chatRoomId);
  });
  it("retries explicit rate limits, and holds uncertain sends without replay", async () => {
    const id = await received(); await sweepTelegram(); const update = await row(id);
    await db.orchestrationRun.update({ where: { id: update.taskId! }, data: { status: "succeeded", result: { text: "Reply" }, completedAt: new Date() } });
    fake.sendMode = "429"; await sweepTelegram(); let delivery = await db.telegramDelivery.findFirstOrThrow({ where: { updateId: id } }); expect(delivery.status).toBe("pending");
    await db.telegramBot.update({ where: { id: binding.id }, data: { nextSendAt: new Date(0) } });
    await db.telegramDelivery.update({ where: { id: delivery.id }, data: { nextAttemptAt: new Date(0) } });
    fake.sendMode = "unknown"; await deliverPending(); delivery = await db.telegramDelivery.findUniqueOrThrow({ where: { id: delivery.id } }); expect(delivery.status).toBe("uncertain");
    const count = fake.sent.length; await deliverPending(); expect(fake.sent.length).toBe(count);
  });
  it("fails closed until enabled, while permitting receive-only inbox verification", async () => {
    process.env.TELEGRAM_GATEWAY_ENABLED = "false"; const id = await received(); await sweepTelegram(); expect((await row(id)).taskId).toBeNull();
  });
  it("uses fixed identity bindings and Unicode-safe long message chunks", () => {
    expect(validSecret("bad", process.env.TELEGRAM_LISA_WEBHOOK_SECRET)).toBe(false);
    expect(chunks("😀".repeat(5000)).every((c) => c.length <= 4096)).toBe(true);
  });
});
