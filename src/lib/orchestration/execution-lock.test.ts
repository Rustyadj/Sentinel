import { afterAll, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { acquireExecutionLock, releaseAgentLocks, releaseExecutionLock } from "./execution-lock";

afterAll(async () => db.$disconnect());

async function makeRoom() {
  return db.chatRoom.create({ data: { name: `execution-lock-test-${Date.now()}-${Math.random()}` } });
}

describe("execution locks", () => {
  it("lets a second agent take an overlapping resource once the first lock is released", async () => {
    const room = await makeRoom();
    const lock = await acquireExecutionLock({
      chatRoomId: room.id,
      agentId: "claude-code",
      resourcePattern: "src/lib/orchestration/**",
    });

    await expect(
      acquireExecutionLock({ chatRoomId: room.id, agentId: "codex", resourcePattern: "src/lib/orchestration/orchestrator.ts" }),
    ).rejects.toMatchObject({ code: "execution_lock_conflict", status: 409 });

    await releaseExecutionLock(lock.id);

    await expect(
      acquireExecutionLock({ chatRoomId: room.id, agentId: "codex", resourcePattern: "src/lib/orchestration/orchestrator.ts" }),
    ).resolves.toMatchObject({ agentId: "codex" });
  });

  it("does not conflict on disjoint resources or two read locks", async () => {
    const room = await makeRoom();
    await acquireExecutionLock({ chatRoomId: room.id, agentId: "claude-code", resourcePattern: "src/lib/orchestration/**" });

    await expect(
      acquireExecutionLock({ chatRoomId: room.id, agentId: "codex", resourcePattern: "src/components/collaboration/**" }),
    ).resolves.toMatchObject({ agentId: "codex" });

    await expect(
      acquireExecutionLock({ chatRoomId: room.id, agentId: "hermes-lisa", resourcePattern: "src/lib/orchestration/**", mode: "read" }),
    ).rejects.toMatchObject({ code: "execution_lock_conflict" });
  });

  it("releaseAgentLocks frees every active lock the agent holds in the room", async () => {
    const room = await makeRoom();
    await acquireExecutionLock({ chatRoomId: room.id, agentId: "claude-code", resourcePattern: "a/**" });
    await acquireExecutionLock({ chatRoomId: room.id, agentId: "claude-code", resourcePattern: "b/**" });

    await releaseAgentLocks(room.id, "claude-code");

    await expect(
      acquireExecutionLock({ chatRoomId: room.id, agentId: "codex", resourcePattern: "a/file.ts" }),
    ).resolves.toMatchObject({ agentId: "codex" });
  });
});
