import { db } from "@/lib/db";
import { getVpsAgent } from "@/lib/agents/registry";
import { RUNTIME_AGENT_MAP, runtimeEventText } from "@/lib/agents/runtime/chat-routing";
import { requireRuntimeAccess, RUNTIME_PERMISSIONS } from "@/lib/agents/runtime/authorization";
import { asRuntimeInstance } from "@/lib/agents/runtime/config";
import { getRuntimeAdapter } from "@/lib/agents/runtime/service";
import { assessRisk, requestApprovalGate, requiresApproval } from "./approval-gate";
import { buildAgentContext } from "./context-builder";
import { emitCollaborationEvent } from "./event-bus";
import { acquireExecutionLock, releaseAgentLocks } from "./execution-lock";
import { postCollaborationMessage } from "./messages";
import type { RoomRoster } from "./roles";
import { resolveAgentRole } from "./roles";
import { createRoomTask, setTaskStatus } from "./task-router";

const MAX_REVIEW_CYCLES = 3;

export interface RunCollaborationInput {
  chatRoomId: string;
  userId: string;
  userContent: string;
}

async function resolveRoster(agentIds: string[]): Promise<RoomRoster> {
  const roster: RoomRoster = {};
  for (const agentId of agentIds) {
    const vpsAgent = getVpsAgent(agentId);
    if (!vpsAgent) continue;
    const role = resolveAgentRole(vpsAgent.kind);
    if (role === "lead" && !roster.lead) roster.lead = agentId;
    if (role === "implementation" && !roster.implementation) roster.implementation = agentId;
    if (role === "review" && !roster.review) roster.review = agentId;
  }
  return roster;
}

async function runAgentTurn(input: { roomId: string; agentId: string; userId: string; prompt: string }): Promise<string> {
  const route = RUNTIME_AGENT_MAP[input.agentId];
  if (!route) throw new Error(`No runtime route for agent ${input.agentId}`);
  const { runtime } = await requireRuntimeAccess(route.runtimeId, RUNTIME_PERMISSIONS.execute);
  const adapter = getRuntimeAdapter(runtime.kind);
  const readiness = await adapter.readiness(asRuntimeInstance(runtime));
  if (!readiness.ready) throw new Error(`Runtime unavailable: ${readiness.reason ?? "not ready"}`);

  let session = await db.agentSession.findFirst({
    where: {
      runtimeInstanceId: runtime.id,
      userId: input.userId,
      chatRoomId: input.roomId,
      status: { notIn: ["running", "cancelled", "timed_out"] },
    },
    orderBy: { lastActivityAt: "desc" },
  });
  if (!session) {
    const created = await adapter.startSession({ runtimeId: runtime.id, userId: input.userId, workspaceId: runtime.workspaceId });
    session = await db.agentSession.update({ where: { id: created.id }, data: { chatRoomId: input.roomId } });
  }

  let fullContent = "";
  for await (const event of adapter.send({ sessionId: session.id, prompt: input.prompt, userId: input.userId })) {
    const text = runtimeEventText(event);
    if (text) fullContent += text;
  }
  return fullContent;
}

/**
 * Runs one lead -> implement -> review cycle for a user request in a
 * CollaborationRoom: creates a task, delegates it to the room's
 * implementation agent, has the review agent check the result, and loops
 * the review<->fix cycle up to MAX_REVIEW_CYCLES before escalating to an
 * AgentDisagreement the human has to resolve (spec's loop-protection).
 *
 * Runs fire-and-forget from the API route (this app is a long-running
 * `next start` server behind Traefik, not a serverless function, so a
 * background promise the request doesn't await keeps running); progress
 * is visible entirely through the persisted messages/tasks/events the
 * room's SSE stream picks up, never through this function's return value.
 */
export async function runCollaborationTurn(input: RunCollaborationInput): Promise<void> {
  const room = await db.chatRoom.findFirstOrThrow({ where: { id: input.chatRoomId, userId: input.userId } });
  const roster = await resolveRoster(room.agentIds);

  await postCollaborationMessage({
    chatRoomId: room.id,
    senderAgentId: "user",
    recipientAgentIds: roster.lead ? [roster.lead] : [],
    type: "MESSAGE",
    content: input.userContent,
  });

  if (room.paused) {
    await emitCollaborationEvent(room.id, "agent.failed", { reason: "Room is paused; message recorded but no task was started" });
    return;
  }

  if (!roster.lead || !roster.implementation) {
    await emitCollaborationEvent(room.id, "agent.failed", { reason: "Room has no lead/implementation agent configured" });
    return;
  }

  const task = await createRoomTask({
    chatRoomId: room.id,
    title: input.userContent.slice(0, 120),
    description: input.userContent,
    ownerAgentId: roster.implementation,
    reviewerAgentId: roster.review,
    createdByAgentId: roster.lead,
  });
  await emitCollaborationEvent(room.id, "task.created", { taskId: task.id, title: task.title });

  await postCollaborationMessage({
    chatRoomId: room.id,
    senderAgentId: roster.lead,
    recipientAgentIds: roster.review ? [roster.implementation, roster.review] : [roster.implementation],
    type: "DELEGATION",
    taskId: task.id,
    content: `Delegating "${task.title}" to ${roster.implementation}${roster.review ? ` with ${roster.review} reviewing` : ""}.`,
  });
  await emitCollaborationEvent(room.id, "task.claimed", { taskId: task.id, agentId: roster.implementation });

  const risk = assessRisk(input.userContent);
  if (requiresApproval(risk)) {
    const approval = await requestApprovalGate({
      chatRoomId: room.id,
      taskId: task.id,
      requesterAgentId: roster.implementation,
      title: `Approval required: ${task.title}`,
      description: input.userContent,
      command: input.userContent,
    });
    await setTaskStatus(task.id, "APPROVAL_REQUIRED");
    await emitCollaborationEvent(room.id, "approval.requested", { taskId: task.id, approvalId: approval.id, risk });
    return; // resumeAfterApproval() picks this task back up once a human decides
  }

  await executeTask(room.id, task.id, roster, input.userId);
}

async function executeTask(roomId: string, taskId: string, roster: RoomRoster, userId: string): Promise<void> {
  if (!roster.implementation) return;
  await setTaskStatus(taskId, "RUNNING");
  await emitCollaborationEvent(roomId, "task.started", { taskId, agentId: roster.implementation });

  const lock = await acquireExecutionLock({
    chatRoomId: roomId,
    taskId,
    agentId: roster.implementation,
    resourcePattern: `room:${roomId}/task:${taskId}/**`,
  }).catch((error) => {
    console.error("[orchestrator] execution lock conflict", error);
    return null;
  });

  let cycles = 0;
  try {
    let feedback = "";
    while (cycles <= MAX_REVIEW_CYCLES) {
      const room = await db.chatRoom.findUnique({ where: { id: roomId }, select: { paused: true } });
      if (room?.paused) {
        await setTaskStatus(taskId, "BLOCKED");
        await emitCollaborationEvent(roomId, "task.blocked", { taskId, reason: "room_paused" });
        return;
      }
      const context = await buildAgentContext({
        chatRoomId: roomId,
        taskId,
        agentId: roster.implementation,
        extra: feedback ? `Reviewer feedback to address:\n${feedback}` : undefined,
      });
      const implementationResult = await runAgentTurn({ roomId, agentId: roster.implementation, userId, prompt: context });

      const artifact = await db.artifact.create({
        data: {
          type: "code_diff",
          title: `${roster.implementation} result for ${taskId}`,
          content: implementationResult.slice(0, 20_000),
          createdBy: roster.implementation,
          chatRoomId: roomId,
          taskId,
        },
      });
      await emitCollaborationEvent(roomId, "artifact.created", { taskId, artifactId: artifact.id });
      await postCollaborationMessage({
        chatRoomId: roomId,
        senderAgentId: roster.implementation,
        recipientAgentIds: roster.review ? [roster.review] : roster.lead ? [roster.lead] : [],
        type: "RESULT",
        taskId,
        artifactIds: [artifact.id],
        content: implementationResult.slice(0, 4_000),
      });

      if (!roster.review) {
        await setTaskStatus(taskId, "COMPLETED");
        await emitCollaborationEvent(roomId, "task.completed", { taskId });
        return;
      }

      await setTaskStatus(taskId, "WAITING_REVIEW");
      await emitCollaborationEvent(roomId, "task.review_requested", { taskId, agentId: roster.review });

      const reviewContext = await buildAgentContext({
        chatRoomId: roomId,
        taskId,
        agentId: roster.review,
        extra: 'Review the implementation above. Reply with a first line of exactly "VERDICT: APPROVE" or "VERDICT: CHANGES_REQUESTED", followed by your reasoning.',
      });
      const reviewResult = await runAgentTurn({ roomId, agentId: roster.review, userId, prompt: reviewContext });
      const approved = /VERDICT:\s*APPROVE/i.test(reviewResult) && !/VERDICT:\s*CHANGES_REQUESTED/i.test(reviewResult);

      if (approved) {
        await postCollaborationMessage({
          chatRoomId: roomId,
          senderAgentId: roster.review,
          recipientAgentIds: roster.lead ? [roster.lead, roster.implementation] : [roster.implementation],
          type: "RESULT",
          taskId,
          content: reviewResult.slice(0, 4_000),
        });
        await setTaskStatus(taskId, "COMPLETED");
        await emitCollaborationEvent(roomId, "task.completed", { taskId });
        if (roster.lead) {
          await db.decision.create({
            data: {
              title: `Completed: ${taskId}`,
              summary: reviewResult.slice(0, 1_000),
              createdBy: roster.review,
              approvedBy: roster.lead,
              chatRoomId: roomId,
              relatedTaskIds: [taskId],
            },
          });
          await emitCollaborationEvent(roomId, "decision.created", { taskId });
        }
        return;
      }

      await postCollaborationMessage({
        chatRoomId: roomId,
        senderAgentId: roster.review,
        recipientAgentIds: [roster.implementation],
        type: "CHANGES_REQUESTED",
        taskId,
        content: reviewResult.slice(0, 4_000),
      });
      await emitCollaborationEvent(roomId, "task.review_failed", { taskId, cycle: cycles });
      await setTaskStatus(taskId, "CHANGES_REQUESTED");
      feedback = reviewResult;
      cycles += 1;
    }

    await setTaskStatus(taskId, "BLOCKED");
    await emitCollaborationEvent(roomId, "task.blocked", { taskId, reason: "max_review_cycles_reached" });
    await db.agentDisagreement.create({
      data: {
        chatRoomId: roomId,
        taskId,
        issue: `${roster.implementation} and ${roster.review} could not converge after ${MAX_REVIEW_CYCLES} review cycles`,
        positions: [
          { agentId: roster.implementation, position: "Believes the latest revision addresses the requested changes." },
          { agentId: roster.review, position: "Still has unresolved concerns about the implementation." },
        ],
        severity: "high",
      },
    });
  } catch (error) {
    await setTaskStatus(taskId, "FAILED");
    await emitCollaborationEvent(roomId, "agent.failed", { taskId, error: error instanceof Error ? error.message : "Unknown error" });
  } finally {
    if (lock) await releaseAgentLocks(roomId, roster.implementation, taskId);
  }
}

export async function resumeAfterApproval(taskId: string): Promise<void> {
  const task = await db.task.findUniqueOrThrow({ where: { id: taskId } });
  if (!task.chatRoomId) return;
  const room = await db.chatRoom.findUniqueOrThrow({ where: { id: task.chatRoomId } });
  if (!room.userId) return;
  const roster = await resolveRoster(room.agentIds);
  await emitCollaborationEvent(room.id, "approval.granted", { taskId });
  await executeTask(room.id, taskId, roster, room.userId);
}
