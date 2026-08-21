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

describe("syncGraphForEvent (via emitCollaborationEvent)", () => {
  it("creates a Task node and belongs_to/assigned_to edges when a task event carries a taskId", async () => {
    const user = await makeUser();
    const room = await makeRoom(user.id);
    const task = await db.task.create({
      data: { chatRoomId: room.id, title: "Graph-synced task", agentId: "claude-code", createdByAgentId: "hermes-lisa" },
    });

    await emitCollaborationEvent(room.id, "task.created", { taskId: task.id, title: task.title });
    // syncGraphForEvent runs fire-and-forget off the transaction; give the
    // microtask queue a turn before asserting on its side effects.
    await new Promise((resolve) => setTimeout(resolve, 50));

    const taskNode = await findNode("task", task.id);
    expect(taskNode).toBeTruthy();
    expect(taskNode?.type).toBe("Task");

    const roomNode = await findNode("chat_room", room.id);
    expect(roomNode).toBeTruthy();
    expect(roomNode?.type).toBe("Conversation");

    const agentNode = await findNode("collaboration_agent", "claude-code");
    expect(agentNode).toBeTruthy();
    expect(agentNode?.type).toBe("Agent");

    const belongsToEdge = await db.knowledgeEdge.findFirst({
      where: { fromObjectId: taskNode!.id, toObjectId: roomNode!.id, type: "belongs_to" },
    });
    expect(belongsToEdge).toBeTruthy();

    const assignedToEdge = await db.knowledgeEdge.findFirst({
      where: { fromObjectId: taskNode!.id, toObjectId: agentNode!.id, type: "assigned_to" },
    });
    expect(assignedToEdge).toBeTruthy();

    const creatorNode = await findNode("collaboration_agent", "hermes-lisa");
    const createdByEdge = await db.knowledgeEdge.findFirst({
      where: { fromObjectId: taskNode!.id, toObjectId: creatorNode!.id, type: "created_by" },
    });
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
    await new Promise((resolve) => setTimeout(resolve, 50));

    const decisionNode = await findNode("decision", decision.id);
    expect(decisionNode).toBeTruthy();
    expect(decisionNode?.type).toBe("Decision");

    const roomNode = await findNode("chat_room", room.id);
    const belongsToEdge = await db.knowledgeEdge.findFirst({
      where: { fromObjectId: decisionNode!.id, toObjectId: roomNode!.id, type: "belongs_to" },
    });
    expect(belongsToEdge).toBeTruthy();

    const creatorNode = await findNode("collaboration_agent", "codex");
    const createdByEdge = await db.knowledgeEdge.findFirst({
      where: { fromObjectId: decisionNode!.id, toObjectId: creatorNode!.id, type: "created_by" },
    });
    expect(createdByEdge).toBeTruthy();

    const approvedByEdge = await db.knowledgeEdge.findFirst({
      where: { fromObjectId: decisionNode!.id, toObjectId: creatorNode!.id, type: "approved_by" },
    });
    expect(approvedByEdge).toBeTruthy();

    const taskNode = await findNode("task", task.id);
    const referencesEdge = await db.knowledgeEdge.findFirst({
      where: { fromObjectId: decisionNode!.id, toObjectId: taskNode!.id, type: "references" },
    });
    expect(referencesEdge).toBeTruthy();
  });

  it("does not create any graph node for an unrelated event type, or when a room has no owning user", async () => {
    const room = await db.chatRoom.create({ data: { name: `graph-sync-no-user-${Date.now()}-${Math.random()}` } });
    const task = await db.task.create({ data: { chatRoomId: room.id, title: "Ownerless room task" } });

    await emitCollaborationEvent(room.id, "task.created", { taskId: task.id, title: task.title });
    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(await findNode("task", task.id)).toBeNull();
  });
});
