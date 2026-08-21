import { afterAll, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { getAgentRoutingStats, historicalSuccessAdjustment, recordExecutionOutcome } from "./adaptive-routing";

afterAll(async () => db.$disconnect());

let seq = 0;
function uid(prefix: string): string {
  seq += 1;
  return `${prefix}-${Date.now()}-${seq}`;
}

async function makeRoomAndTask() {
  const room = await db.chatRoom.create({ data: { name: uid("adaptive-routing-test") } });
  const task = await db.task.create({ data: { chatRoomId: room.id, title: "probe task" } });
  return { room, task };
}

describe("historicalSuccessAdjustment", () => {
  it("returns 0 below the minimum sample size, regardless of outcome", async () => {
    const { room, task } = await makeRoomAndTask();
    const agentId = uid("agent");
    await recordExecutionOutcome({ chatRoomId: room.id, taskId: task.id, agentId, capabilities: ["backend"], success: false });
    await recordExecutionOutcome({ chatRoomId: room.id, taskId: task.id, agentId, capabilities: ["backend"], success: false });
    expect(await historicalSuccessAdjustment(agentId, ["backend"])).toBe(0);
  });

  it("nudges the score up for a strong track record and down for a poor one, once enough samples exist", async () => {
    const { room, task } = await makeRoomAndTask();
    const strongAgent = uid("agent-strong");
    const poorAgent = uid("agent-poor");
    for (let i = 0; i < 5; i += 1) {
      await recordExecutionOutcome({ chatRoomId: room.id, taskId: task.id, agentId: strongAgent, capabilities: ["backend"], success: true });
    }
    expect(await historicalSuccessAdjustment(strongAgent, ["backend"])).toBeGreaterThan(0);

    for (let i = 0; i < 5; i += 1) {
      await recordExecutionOutcome({ chatRoomId: room.id, taskId: task.id, agentId: poorAgent, capabilities: ["backend"], success: false });
    }
    expect(await historicalSuccessAdjustment(poorAgent, ["backend"])).toBeLessThan(0);
  });

  it("caps the adjustment magnitude rather than letting it swing unbounded", async () => {
    const { room, task } = await makeRoomAndTask();
    const agentId = uid("agent-capped");
    for (let i = 0; i < 20; i += 1) {
      await recordExecutionOutcome({ chatRoomId: room.id, taskId: task.id, agentId, capabilities: ["testing"], success: true });
    }
    expect(await historicalSuccessAdjustment(agentId, ["testing"])).toBeLessThanOrEqual(0.15);
  });

  it("only weighs outcomes sharing a required capability when capabilities are specified", async () => {
    const { room, task } = await makeRoomAndTask();
    const agentId = uid("agent-scoped");
    for (let i = 0; i < 5; i += 1) {
      await recordExecutionOutcome({ chatRoomId: room.id, taskId: task.id, agentId, capabilities: ["frontend"], success: false });
    }
    // No history at all for "database" specifically -> below sample threshold -> neutral.
    expect(await historicalSuccessAdjustment(agentId, ["database"])).toBe(0);
  });
});

describe("getAgentRoutingStats", () => {
  it("reports null stats for an agent with no history", async () => {
    const stats = await getAgentRoutingStats(uid("agent-no-history"));
    expect(stats).toMatchObject({ sampleSize: 0, successRate: null, averageDurationMs: null, averageReviewCycles: null });
  });

  it("aggregates success rate, duration, and review cycles across recorded outcomes", async () => {
    const { room, task } = await makeRoomAndTask();
    const agentId = uid("agent-stats");
    await recordExecutionOutcome({ chatRoomId: room.id, taskId: task.id, agentId, capabilities: ["backend"], success: true, durationMs: 1_000, reviewCycles: 1 });
    await recordExecutionOutcome({ chatRoomId: room.id, taskId: task.id, agentId, capabilities: ["backend"], success: false, durationMs: 3_000, reviewCycles: 0 });

    const stats = await getAgentRoutingStats(agentId);
    expect(stats.sampleSize).toBe(2);
    expect(stats.successRate).toBe(0.5);
    expect(stats.averageDurationMs).toBe(2_000);
    expect(stats.averageReviewCycles).toBe(0.5);
  });
});
