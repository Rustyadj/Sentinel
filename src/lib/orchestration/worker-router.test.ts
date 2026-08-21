import { afterAll, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { recordExecutionOutcome } from "./adaptive-routing";
import { acquireExecutionLock } from "./execution-lock";
import { selectWorker } from "./worker-router";

afterAll(async () => db.$disconnect());

async function makeRoom() {
  return db.chatRoom.create({ data: { name: `worker-router-test-${Date.now()}-${Math.random()}` } });
}

describe("selectWorker", () => {
  it("picks the candidate whose default capability weights best fit the task, not a fixed agent", async () => {
    const room = await makeRoom();

    const forTesting = await selectWorker({
      chatRoomId: room.id, requiredCapabilities: ["testing", "debugging"], candidates: ["claude-code", "codex"],
    });
    expect(forTesting.agentId).toBe("codex"); // codex's default testing/debugging weights are higher

    const forFrontend = await selectWorker({
      chatRoomId: room.id, requiredCapabilities: ["backend", "refactoring"], candidates: ["claude-code", "codex"],
    });
    expect(forFrontend.agentId).toBe("claude-code"); // claude-code's default backend/refactoring weights are higher
  });

  it("penalizes a candidate with more active workload in the same room", async () => {
    const room = await makeRoom();
    for (let i = 0; i < 5; i += 1) {
      await db.task.create({ data: { chatRoomId: room.id, title: `busy-${i}`, agentId: "claude-code", status: "RUNNING" } });
    }

    // Same capability profile either way (backend), but claude-code is
    // buried in active work — codex should win purely on workload.
    const selection = await selectWorker({ chatRoomId: room.id, requiredCapabilities: ["backend"], candidates: ["claude-code", "codex"] });
    expect(selection.agentId).toBe("codex");
    expect(selection.reason).toContain("workload");
  });

  it("penalizes a candidate whose file scope conflicts with an active lock held by someone else", async () => {
    const room = await makeRoom();
    await acquireExecutionLock({ chatRoomId: room.id, agentId: "codex", resourcePattern: "src/lib/orchestration/**" });

    const selection = await selectWorker({
      chatRoomId: room.id, requiredCapabilities: ["backend"], candidates: ["claude-code", "codex"],
      fileScope: ["src/lib/orchestration/orchestrator.ts"],
    });
    // claude-code has the higher raw backend score, but codex already holds
    // this exact path locked, so routing there would just create a conflict.
    expect(selection.agentId).toBe("codex");
  });

  it("excludes agents passed in `exclude` (e.g. the implementer, when picking a reviewer)", async () => {
    const room = await makeRoom();
    const selection = await selectWorker({ chatRoomId: room.id, requiredCapabilities: [], candidates: ["claude-code", "codex"], exclude: ["claude-code"] });
    expect(selection.agentId).toBe("codex");
  });

  it("breaks a tie between otherwise-equal candidates using their actual track record", async () => {
    // Unregistered synthetic ids both fall back to a neutral 0.5 capability
    // score for any required capability, so a seeded history is the only
    // thing that can separate them here — proving selectWorker really does
    // weigh outcomes, not just static weights.
    const room = await makeRoom();
    const task = await db.task.create({ data: { chatRoomId: room.id, title: "history seed task" } });
    const strongAgent = `worker-router-strong-${Date.now()}`;
    const poorAgent = `worker-router-poor-${Date.now()}`;
    for (let i = 0; i < 5; i += 1) {
      await recordExecutionOutcome({ chatRoomId: room.id, taskId: task.id, agentId: strongAgent, capabilities: ["research"], success: true });
      await recordExecutionOutcome({ chatRoomId: room.id, taskId: task.id, agentId: poorAgent, capabilities: ["research"], success: false });
    }

    const selection = await selectWorker({ chatRoomId: room.id, requiredCapabilities: ["research"], candidates: [strongAgent, poorAgent] });
    expect(selection.agentId).toBe(strongAgent);
    expect(selection.reason).toContain("history=+");
  });
});
