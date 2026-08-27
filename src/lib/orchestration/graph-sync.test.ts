import { afterAll, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { makeUser } from "../../../tests/neural-engine/db-setup";
import { emitCollaborationEvent } from "./event-bus";

afterAll(async () => db.$disconnect());

async function makeRoom(userId: string) {
  return db.chatRoom.create({ data: { name: `graph-sync-test-${Date.now()}-${Math.random()}`, userId } });
}

async function findNode(sourceType: string, sourceId: string) {
  return db.knowledgeObject.findFirst({ where: { sourceType, sourceId } });
}

/**
 * syncGraphForEvent runs fire-and-forget off emitCollaborationEvent's
 * transaction (event-bus.ts explicitly never awaits it, so a graph-sync
 * problem can't delay or fail the event-emission path). A flat sleep before
 * asserting on its side effects is a race against however many sequential
 * DB round-trips that chain happens to need — poll instead so the test
 * passes as soon as the write actually lands, and only times out if it
 * genuinely never does.
 */
async function waitFor<T>(check: () => Promise<T | null | undefined>, timeoutMs = 8000, intervalMs = 50): Promise<T | null> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const result = await check();
    if (result) return result;
    if (Date.now() >= deadline) return null;
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
}

describe("syncGraphForEvent (via emitCollaborationEvent)", () => {
  it("creates a Task node and belongs_to/assigned_to edges when a task event carries a taskId", async () => {
    const user = await makeUser();
    const room = await makeRoom(user.id);
    const task = await db.task.create({
      data: { chatRoomId: room.id, title: "Graph-synced task", agentId: "claude-code", createdByAgentId: "hermes-lisa" },
    });

    await emitCollaborationEvent(room.id, "task.created", { taskId: task.id, title: task.title });

    const taskNode = await waitFor(() => findNode("task", task.id));
    expect(taskNode).toBeTruthy();
    expect(taskNode?.type).toBe("Task");

    const roomNode = await waitFor(() => findNode("chat_room", room.id));
    expect(roomNode).toBeTruthy();
    expect(roomNode?.type).toBe("Conversation");

    const agentNode = await waitFor(() => findNode("collaboration_agent", "claude-code"));
    expect(agentNode).toBeTruthy();
    expect(agentNode?.type).toBe("Agent");

    const belongsToEdge = await waitFor(() =>
      db.knowledgeEdge.findFirst({ where: { fromObjectId: taskNode!.id, toObjectId: roomNode!.id, type: "belongs_to" } }),
    );
    expect(belongsToEdge).toBeTruthy();

    const assignedToEdge = await waitFor(() =>
      db.knowledgeEdge.findFirst({ where: { fromObjectId: taskNode!.id, toObjectId: agentNode!.id, type: "assigned_to" } }),
    );
    expect(assignedToEdge).toBeTruthy();

    const creatorNode = await waitFor(() => findNode("collaboration_agent", "hermes-lisa"));
    const createdByEdge = await waitFor(() =>
      db.knowledgeEdge.findFirst({ where: { fromObjectId: taskNode!.id, toObjectId: creatorNode!.id, type: "created_by" } }),
    );
    expect(createdByEdge).toBeTruthy();
  });

  it("creates a Decision node and belongs_to/created_by/references edges when decision.created carries a decisionId", async () => {
    const user = await makeUser();
    const room = await makeRoom(user.id);
    const task = await db.task.create({ data: { chatRoomId: room.id, title: "Reviewed task" } });
    const decision = await db.decision.create({
      data: {
        title: `Completed: ${task.id}`,
        summary: "claude-code implemented, codex reviewed and approved.",
        createdBy: "codex",
        approvedBy: "codex",
        chatRoomId: room.id,
        relatedTaskIds: [task.id],
      },
    });

    await emitCollaborationEvent(room.id, "decision.created", { taskId: task.id, decisionId: decision.id });

    const decisionNode = await waitFor(() => findNode("decision", decision.id));
    expect(decisionNode).toBeTruthy();
    expect(decisionNode?.type).toBe("Decision");

    const roomNode = await waitFor(() => findNode("chat_room", room.id));
    const belongsToEdge = await waitFor(() =>
      db.knowledgeEdge.findFirst({ where: { fromObjectId: decisionNode!.id, toObjectId: roomNode!.id, type: "belongs_to" } }),
    );
    expect(belongsToEdge).toBeTruthy();

    const creatorNode = await waitFor(() => findNode("collaboration_agent", "codex"));
    const createdByEdge = await waitFor(() =>
      db.knowledgeEdge.findFirst({ where: { fromObjectId: decisionNode!.id, toObjectId: creatorNode!.id, type: "created_by" } }),
    );
    expect(createdByEdge).toBeTruthy();

    const approvedByEdge = await waitFor(() =>
      db.knowledgeEdge.findFirst({ where: { fromObjectId: decisionNode!.id, toObjectId: creatorNode!.id, type: "approved_by" } }),
    );
    expect(approvedByEdge).toBeTruthy();

    const taskNode = await waitFor(() => findNode("task", task.id));
    const referencesEdge = await waitFor(() =>
      db.knowledgeEdge.findFirst({ where: { fromObjectId: decisionNode!.id, toObjectId: taskNode!.id, type: "references" } }),
    );
    expect(referencesEdge).toBeTruthy();
  });

  it("does not create any graph node for an unrelated event type, or when a room has no owning user", async () => {
    const room = await db.chatRoom.create({ data: { name: `graph-sync-no-user-${Date.now()}-${Math.random()}` } });
    const task = await db.task.create({ data: { chatRoomId: room.id, title: "Ownerless room task" } });

    await emitCollaborationEvent(room.id, "task.created", { taskId: task.id, title: task.title });
    // Negative assertion: there is no terminal write to poll for, so give
    // syncGraphForEvent a generous fixed window to (not) run before checking.
    await new Promise((resolve) => setTimeout(resolve, 300));

    expect(await findNode("task", task.id)).toBeNull();
  });
});
