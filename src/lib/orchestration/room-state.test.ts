import { afterAll, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { getRoomSnapshot } from "./room-state";

afterAll(async () => db.$disconnect());

async function makeRoom(agentIds: string[]) {
  return db.chatRoom.create({ data: { name: `room-state-test-${Date.now()}-${Math.random()}`, agentIds } });
}

async function makeSession(runtimeInstanceId: string, agentId: string, chatRoomId: string, status: string) {
  return db.agentSession.create({
    data: { runtime: "claude-code", runtimeInstanceId, agentId, userId: "test-user", chatRoomId, status },
  });
}

describe("getRoomSnapshot — participant status reflects real work, not decorative labels", () => {
  it("shows a worker's real active task status instead of an idle default", async () => {
    const room = await makeRoom(["claude-code"]);
    await db.task.create({ data: { chatRoomId: room.id, title: "Build the thing", agentId: "claude-code", status: "RUNNING" } });

    const snapshot = await getRoomSnapshot(room.id);
    const claude = snapshot.participants.find((p) => p.agentId === "claude-code")!;
    expect(claude.status).toBe("running");
    expect(claude.activeTaskId).toBeDefined();
  });

  it("shows 'available' for a worker with no active task, even if its last session ended completed", async () => {
    const room = await makeRoom(["codex"]);
    await makeSession("runtime-codex", "codex", room.id, "completed");

    const snapshot = await getRoomSnapshot(room.id);
    const codex = snapshot.participants.find((p) => p.agentId === "codex")!;
    expect(codex.status).toBe("available");
    expect(codex.activeTaskId).toBeUndefined();
  });

  it("shows 'available' for a worker with no session and no task at all", async () => {
    const room = await makeRoom(["codex"]);
    const snapshot = await getRoomSnapshot(room.id);
    expect(snapshot.participants.find((p) => p.agentId === "codex")!.status).toBe("available");
  });

  it("shows Lisa as 'coordinating' while her own session is running, since she never owns a task directly", async () => {
    const room = await makeRoom(["hermes-lisa"]);
    await makeSession("runtime-hermes-lisa", "hermes-lisa", room.id, "running");

    const snapshot = await getRoomSnapshot(room.id);
    expect(snapshot.participants.find((p) => p.agentId === "hermes-lisa")!.status).toBe("coordinating");
  });

  it("shows Lisa as 'available' when she has no running session", async () => {
    const room = await makeRoom(["hermes-lisa"]);
    await makeSession("runtime-hermes-lisa", "hermes-lisa", room.id, "completed");

    const snapshot = await getRoomSnapshot(room.id);
    expect(snapshot.participants.find((p) => p.agentId === "hermes-lisa")!.status).toBe("available");
  });
});
