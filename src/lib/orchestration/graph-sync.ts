import { db } from "@/lib/db";
import { getVpsAgent } from "@/lib/agents/registry";
import { syncEntityToGraph, syncTaskToGraph } from "@/lib/knowledge/entity-sync";
import { upsertEdge } from "@/lib/knowledge/edges";
import type { CollaborationEventType } from "@/types/collaboration";

/**
 * Live sync of collaboration-room state into Sentinel's actual knowledge
 * graph — real KnowledgeObject/KnowledgeEdge rows, not a separate
 * visualization data model. Reuses syncTaskToGraph (a Task row is a Task
 * row whether it came from the kanban API or a collaboration room) and
 * the existing upsertEdge, so a task/agent/decision that already has a
 * graph node from elsewhere in Sentinel gets its existing node updated
 * rather than duplicated. Called from event-bus.ts on every
 * CollaborationEvent, so the graph reflects orchestration state as it
 * actually changes rather than needing a separate poll/rebuild step.
 */

async function syncRoomToGraph(chatRoomId: string): Promise<string | null> {
  const room = await db.chatRoom.findUnique({ where: { id: chatRoomId }, select: { id: true, name: true, userId: true } });
  if (!room) return null;
  return syncEntityToGraph({
    type: "Conversation", title: room.name, sourceType: "chat_room", sourceId: room.id,
    scope: "user", ownerUserId: room.userId,
  });
}

async function syncAgentToGraph(agentId: string): Promise<string | null> {
  const vpsAgent = getVpsAgent(agentId);
  if (!vpsAgent) return null;
  return syncEntityToGraph({
    type: "Agent", title: vpsAgent.name, summary: vpsAgent.description, sourceType: "collaboration_agent", sourceId: agentId,
    scope: "global", metadata: { kind: vpsAgent.kind, model: vpsAgent.model },
  });
}

async function syncCollaborationTaskToGraph(chatRoomId: string, taskId: string): Promise<void> {
  const task = await db.task.findUnique({ where: { id: taskId } });
  if (!task || task.chatRoomId !== chatRoomId) return;
  const room = await db.chatRoom.findUnique({ where: { id: chatRoomId }, select: { userId: true } });
  if (!room?.userId) return;

  const taskNodeId = await syncTaskToGraph(task, room.userId);
  const roomNodeId = await syncRoomToGraph(chatRoomId);
  if (roomNodeId) await upsertEdge({ fromObjectId: taskNodeId, toObjectId: roomNodeId, type: "belongs_to" });

  if (task.agentId) {
    const agentNodeId = await syncAgentToGraph(task.agentId);
    if (agentNodeId) await upsertEdge({ fromObjectId: taskNodeId, toObjectId: agentNodeId, type: "assigned_to" });
  }
  if (task.reviewerAgentId) {
    const reviewerNodeId = await syncAgentToGraph(task.reviewerAgentId);
    if (reviewerNodeId) await upsertEdge({ fromObjectId: taskNodeId, toObjectId: reviewerNodeId, type: "reviewed_by" });
  }
  if (task.createdByAgentId) {
    const creatorNodeId = await syncAgentToGraph(task.createdByAgentId);
    if (creatorNodeId) await upsertEdge({ fromObjectId: taskNodeId, toObjectId: creatorNodeId, type: "created_by" });
  }
  for (const dependsOnTaskId of task.dependsOnTaskIds) {
    const depTask = await db.task.findUnique({ where: { id: dependsOnTaskId } });
    if (!depTask) continue;
    const depNodeId = await syncTaskToGraph(depTask, room.userId);
    await upsertEdge({ fromObjectId: taskNodeId, toObjectId: depNodeId, type: "depends_on" });
  }
}

async function syncDecisionToGraph(chatRoomId: string, decisionId: string): Promise<void> {
  const decision = await db.decision.findUnique({ where: { id: decisionId } });
  if (!decision || decision.chatRoomId !== chatRoomId) return;
  const room = await db.chatRoom.findUnique({ where: { id: chatRoomId }, select: { userId: true } });
  if (!room?.userId) return;

  const decisionNodeId = await syncEntityToGraph({
    type: "Decision", title: decision.title, summary: decision.summary, sourceType: "decision", sourceId: decision.id,
    scope: "user", ownerUserId: room.userId, metadata: { status: decision.status },
  });
  const roomNodeId = await syncRoomToGraph(chatRoomId);
  if (roomNodeId) await upsertEdge({ fromObjectId: decisionNodeId, toObjectId: roomNodeId, type: "belongs_to" });

  const creatorNodeId = await syncAgentToGraph(decision.createdBy);
  if (creatorNodeId) await upsertEdge({ fromObjectId: decisionNodeId, toObjectId: creatorNodeId, type: "created_by" });
  if (decision.approvedBy) {
    const approverNodeId = await syncAgentToGraph(decision.approvedBy);
    if (approverNodeId) await upsertEdge({ fromObjectId: decisionNodeId, toObjectId: approverNodeId, type: "approved_by" });
  }
  for (const relatedTaskId of decision.relatedTaskIds) {
    const task = await db.task.findUnique({ where: { id: relatedTaskId } });
    if (!task) continue;
    const taskNodeId = await syncTaskToGraph(task, room.userId);
    await upsertEdge({ fromObjectId: decisionNodeId, toObjectId: taskNodeId, type: "references" });
  }
}

const TASK_SYNC_EVENTS = new Set<CollaborationEventType>([
  "task.created", "task.claimed", "task.started", "task.blocked",
  "task.completed", "task.review_requested", "task.review_failed", "artifact.created",
]);

/** Best-effort: called from event-bus.ts after every CollaborationEvent is
 *  persisted. Failures are logged, never thrown — a graph-sync problem
 *  must not break the orchestration event it's reacting to. */
export async function syncGraphForEvent(chatRoomId: string, type: CollaborationEventType, payload: Record<string, unknown>): Promise<void> {
  try {
    const taskId = typeof payload.taskId === "string" ? payload.taskId : undefined;
    const decisionId = typeof payload.decisionId === "string" ? payload.decisionId : undefined;
    if (TASK_SYNC_EVENTS.has(type) && taskId) {
      await syncCollaborationTaskToGraph(chatRoomId, taskId);
    } else if (type === "decision.created" && decisionId) {
      await syncDecisionToGraph(chatRoomId, decisionId);
    }
  } catch (error) {
    console.error("[graph-sync] failed to sync collaboration graph (non-fatal)", error);
  }
}
