import { afterAll, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { acquireExecutionLock, releaseExecutionLock } from "./execution-lock";
import { assertTaskNotSplitAcrossCodingRuntimes } from "./lisa-loop";

afterAll(async () => db.$disconnect());

async function makeTask(agentId: string) {
  const room = await db.chatRoom.create({ data: { name: `coexec-${Date.now()}-${Math.random()}` } });
  const task = await db.task.create({ data: { chatRoomId: room.id, title: "One task", agentId, capabilities: ["coding"] } });
  return { room, task };
}

/**
 * The bypass this suite exists for: before enforcement, the policy was handed a
 * single-element set at its only call site and could never fire. These tests
 * pin the real boundary — one task worked by both coding runtimes at once is
 * refused, while everything policy explicitly permits still runs.
 */
describe("Claude Code / Codex coexecution enforcement", () => {
  it("refuses Codex while Claude Code still holds the same task", async () => {
    const { room, task } = await makeTask("claude-code");
    const lock = await acquireExecutionLock({ chatRoomId: room.id, taskId: task.id, agentId: "claude-code", resourcePattern: `room:${room.id}/task:${task.id}/**` });

    await expect(assertTaskNotSplitAcrossCodingRuntimes(task.id, "codex")).rejects.toThrow(/cannot work task .* while claude-code is still executing it/);

    await releaseExecutionLock(lock.id);
  });

  it("refuses Claude Code while Codex still holds the same task", async () => {
    const { room, task } = await makeTask("codex");
    const lock = await acquireExecutionLock({ chatRoomId: room.id, taskId: task.id, agentId: "codex", resourcePattern: `room:${room.id}/task:${task.id}/**` });

    await expect(assertTaskNotSplitAcrossCodingRuntimes(task.id, "claude-code")).rejects.toThrow(/cannot work task/);

    await releaseExecutionLock(lock.id);
  });

  it("permits the counterpart once the first runtime releases the task — sequential review is allowed", async () => {
    const { room, task } = await makeTask("claude-code");
    const lock = await acquireExecutionLock({ chatRoomId: room.id, taskId: task.id, agentId: "claude-code", resourcePattern: `room:${room.id}/task:${task.id}/**` });
    await releaseExecutionLock(lock.id);

    await expect(assertTaskNotSplitAcrossCodingRuntimes(task.id, "codex")).resolves.toBeUndefined();
  });

  it("permits distinct tasks on each coding runtime concurrently — independent selection is allowed", async () => {
    const a = await makeTask("claude-code");
    const b = await makeTask("codex");
    const lock = await acquireExecutionLock({ chatRoomId: a.room.id, taskId: a.task.id, agentId: "claude-code", resourcePattern: `room:${a.room.id}/task:${a.task.id}/**` });

    await expect(assertTaskNotSplitAcrossCodingRuntimes(b.task.id, "codex")).resolves.toBeUndefined();

    await releaseExecutionLock(lock.id);
  });

  it("does not constrain agents outside the exclusive pair", async () => {
    const { room, task } = await makeTask("claude-code");
    const lock = await acquireExecutionLock({ chatRoomId: room.id, taskId: task.id, agentId: "claude-code", resourcePattern: `room:${room.id}/task:${task.id}/**` });

    await expect(assertTaskNotSplitAcrossCodingRuntimes(task.id, "hermes-lisa")).resolves.toBeUndefined();

    await releaseExecutionLock(lock.id);
  });
});
