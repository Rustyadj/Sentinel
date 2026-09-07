import { db } from "@/lib/db";
import { getVpsAgent } from "@/lib/agents/registry";
import { runDirectAgentReply } from "./agent-turn";
import { resolveLead, resolveWorkerPool } from "./capabilities";
import { emitCollaborationEvent } from "./event-bus";
import { runLisaLoop } from "./lisa-loop";
import { postCollaborationMessage } from "./messages";

export interface RunCollaborationInput {
  chatRoomId: string;
  userId: string;
  userContent: string;
  /** When exactly one recipient is given, this is a direct @mention: reply
   *  from that agent alone rather than entering Lisa's tool-calling loop. */
  recipientAgentIds?: string[];
}

/**
 * Entry point for a user message in a CollaborationRoom. A direct
 * single-agent @mention gets a direct reply; anything else hands off to
 * Lisa's tool-calling execution loop (lisa-loop.ts), which is where the
 * actual planning, dispatch, monitoring, and recovery now live. Runs
 * fire-and-forget from the API route (this app is a long-running
 * `next start` server behind Traefik, not serverless, so a background
 * promise the request doesn't await keeps running); progress is visible
 * entirely through the persisted messages/tasks/events the room's SSE
 * stream picks up.
 */
export async function runCollaborationTurn(input: RunCollaborationInput): Promise<void> {
  const room = await db.chatRoom.findFirstOrThrow({ where: { id: input.chatRoomId, userId: input.userId } });
  const lead = resolveLead(room.agentIds);
  const pool = resolveWorkerPool(room.agentIds);

  await postCollaborationMessage({
    chatRoomId: room.id, senderAgentId: "user", recipientAgentIds: lead ? [lead] : [], type: "MESSAGE", content: input.userContent,
  });

  if (room.paused) {
    await emitCollaborationEvent(room.id, "agent.failed", { reason: "Room is paused; message recorded but no task was started" });
    return;
  }

  // Exactly one explicit, room-member target is a direct worker override —
  // solo mode's selected agent, or an explicit @mention in collaborative
  // mode. This is a deliberate server-side guard, not just array-length
  // inference: the target must actually be a registered agent AND a
  // participant of this room, so a stray or stale client payload can't
  // reach a worker outside Lisa's orchestration. Anything else (zero
  // targets, or more than one — e.g. collaborative mode's default
  // broadcast-to-all-participants) always goes through Lisa below,
  // regardless of the room's persisted mode.
  const directTargetId = input.recipientAgentIds?.length === 1 ? input.recipientAgentIds[0] : undefined;
  if (directTargetId && room.agentIds.includes(directTargetId) && getVpsAgent(directTargetId)) {
    await runDirectAgentReply(room.id, directTargetId, input.userId, input.userContent);
    return;
  }

  if (!lead || pool.length === 0) {
    await emitCollaborationEvent(room.id, "agent.failed", { reason: "Room has no lead agent or implementation workers configured" });
    return;
  }

  await runLisaLoop({ roomId: room.id, userId: input.userId, lead, pool, objective: room.objective, seed: `User request: ${input.userContent}` });
}

/**
 * Resumes a mission-bridge launch after a human decides a Guardian-gated
 * mission-level approval (see mission-bridge.ts — a mission launch has no
 * Task row yet, so it can't reuse resumeAfterApproval's taskId lookup). The
 * human's decision on this exact ApprovalRequest — already authenticated
 * and permission-checked by the approvals route — is the authorization;
 * this does not re-run Guardian, matching resumeAfterApproval's own
 * "the approval decision itself is the resumption trigger" pattern for
 * Tier 3. A Tier 2 hold's underlying GuardianDecision is resolved
 * separately by the approvals route before this runs (resolveGuardianReview).
 */
export async function resumeMissionAfterApproval(approvalId: string): Promise<void> {
  const approval = await db.approvalRequest.findUniqueOrThrow({ where: { id: approvalId } });
  const payload = approval.payload as Record<string, unknown> | null;
  if (payload?.missionLaunch !== true || !approval.chatRoomId) return;

  const room = await db.chatRoom.findUniqueOrThrow({ where: { id: approval.chatRoomId } });
  if (!room.userId) return;

  const leadAgentId = typeof payload.leadAgentId === "string" ? payload.leadAgentId : resolveLead(room.agentIds);
  if (!leadAgentId) return;

  const rawWorkers = payload.workers;
  const workers = Array.isArray(rawWorkers) && rawWorkers.every((w): w is string => typeof w === "string") && rawWorkers.length > 0
    ? rawWorkers
    : resolveWorkerPool(room.agentIds);
  const objective = typeof payload.objective === "string" ? payload.objective : room.objective ?? "";

  await emitCollaborationEvent(room.id, "approval.granted", { approvalId });
  await runLisaLoop({
    roomId: room.id, userId: room.userId, lead: leadAgentId, pool: workers, objective: room.objective,
    seed: `Mission approved by human operator: ${objective}`,
  });
}

/** Resumes Lisa's loop after a human decides a gated approval — a fresh
 *  invocation rebuilds current state rather than assuming any in-memory
 *  continuation, so this works regardless of how long the approval took. */
export async function resumeAfterApproval(taskId: string): Promise<void> {
  const task = await db.task.findUniqueOrThrow({ where: { id: taskId } });
  if (!task.chatRoomId) return;
  const room = await db.chatRoom.findUniqueOrThrow({ where: { id: task.chatRoomId } });
  if (!room.userId) return;
  const lead = resolveLead(room.agentIds);
  const pool = resolveWorkerPool(room.agentIds);
  if (!lead) return;
  await emitCollaborationEvent(room.id, "approval.granted", { taskId });
  await runLisaLoop({
    roomId: room.id, userId: room.userId, lead, pool, objective: room.objective,
    seed: `Task ${taskId} ("${task.title}") was just approved by the human operator and can now proceed. Continue the objective.`,
  });
}
