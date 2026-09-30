// Live check against a real Hermes runtime. Skipped unless BOT_LIVE_SMOKE=1, because
// it makes a real model call. Everything is real here: the Hermes WebSocket
// adapter, the executor and its Redis lease, the DB, the event log.
import { beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/orchestration/queue", () => ({ enqueueOrchestrationRun: vi.fn().mockResolvedValue(undefined) }));

import { db } from "@/lib/db";
import { executeOrchestrationRun } from "@/lib/orchestration/executor";
import { createBot } from "@/lib/bots/service";
import { delegateToBot, getBotTask } from "@/lib/bots/tasks";
import { botInput, makeWorkspace } from "./fixtures";

const HOST = process.env.BOT_LIVE_HOST ?? "hermes-lisa";

describe.skipIf(process.env.BOT_LIVE_SMOKE !== "1")(`live Hermes smoke (${HOST})`, () => {
  let owner: { id: string }; let workspace: { id: string };
  beforeAll(async () => {
    ({ owner, workspace } = await makeWorkspace());
    // The seeded runtime rows start unverified; verifying is an operator act. Done on the throwaway test database only.
    await db.agentRuntime.update({ where: { id: `runtime-${HOST}` }, data: { executionVerified: true } });
  });

  it("runs a bot task on the real runtime with real usage, a policy-honouring prompt, and a recorded event trail", async () => {
    const bot = await createBot(botInput(workspace.id, {
      name: "Smoke", role: "Echo", runtimeAgentId: HOST, status: "active", modelConfig: process.env.BOT_LIVE_MODEL ? { primary: process.env.BOT_LIVE_MODEL } : {},
      systemPrompt: "You are a test bot. Follow the task exactly and keep the reply to one line.",
    }), owner.id);
    const queued = await delegateToBot(bot.id, { task: "Reply with exactly this text and nothing else: BOT-SMOKE-OK" }, { kind: "user", userId: owner.id });
    await executeOrchestrationRun(queued.id, "live-smoke-worker");
    const task = await getBotTask(queued.id, { userId: owner.id, isAdmin: true });
    const raw = await db.agentRuntimeEvent.findMany({ where: { session: { userId: owner.id } }, orderBy: [{ occurredAt: "asc" }, { sequence: "asc" }], take: 40 });
    console.log("RAW", JSON.stringify(raw.map((e) => ({ t: e.type, p: JSON.stringify(e.payload).slice(0, 220) })), null, 1));
    console.log("LIVE", JSON.stringify({ status: task.status, error: task.error, output: task.output?.text?.slice(0, 200), model: task.model, usage: task.usage, ms: task.durationMs, tools: task.toolCalls, events: task.events.map((e) => `${e.type}: ${e.summary}`) }, null, 1));
    expect(task.status).toBe("COMPLETED");
    expect(task.output?.text).toContain("BOT-SMOKE-OK");
    expect(task.toolCalls).toEqual([]);
  }, 180_000);
});
