import { db } from "@/lib/db";
import { getVpsAgent } from "@/lib/agents/registry";
import { resolveDisplayRole } from "./capabilities";
import type {
  AgentDisagreement,
  AgentHealth,
  AgentMessage,
  CollaborationArtifact,
  CollaborationDecision,
  CollaborationParticipant,
  CollaborationTask,
} from "@/types/collaboration";

export interface CollaborationApprovalDTO {
  id: string;
  title: string;
  command: string;
  environment: string;
  risk: "low" | "medium" | "high";
  requestedByAgentId: string;
  status: "pending" | "approved" | "denied";
}

export interface RoomSnapshot {
  roomId: string;
  roomName: string;
  objective: string | null;
  mode: string;
  autonomyLevel: string;
  participants: CollaborationParticipant[];
  tasks: CollaborationTask[];
  messages: AgentMessage[];
  artifacts: CollaborationArtifact[];
  decisions: CollaborationDecision[];
  disagreements: AgentDisagreement[];
  approvals: CollaborationApprovalDTO[];
  lastEventSequence: number;
}

const ACTIVE_TASK_STATUSES = new Set(["CLAIMED", "RUNNING", "WAITING_REVIEW", "CHANGES_REQUESTED"]);

function participantHealth(sessionStatus: string | undefined): AgentHealth {
  if (!sessionStatus) return "IDLE";
  if (sessionStatus === "running") return "BUSY";
  if (sessionStatus === "failed" || sessionStatus === "timed_out") return "FAILED";
  if (sessionStatus === "cancelled") return "DISCONNECTED";
  return "CONNECTED";
}

/**
 * Builds the full room snapshot the frontend's useCollaborationRoom hook
 * hydrates from — every DTO shape here mirrors src/types/collaboration.ts
 * exactly since that file is the contract both the frontend and backend
 * tracks built against independently.
 */
export async function getRoomSnapshot(chatRoomId: string): Promise<RoomSnapshot> {
  const room = await db.chatRoom.findUniqueOrThrow({ where: { id: chatRoomId } });

  const [tasks, messages, artifacts, decisions, disagreements, approvals, sessions, lastEvent] = await Promise.all([
    db.task.findMany({ where: { chatRoomId }, orderBy: { createdAt: "asc" } }),
    db.message.findMany({ where: { chatRoomId }, orderBy: { createdAt: "asc" } }),
    db.artifact.findMany({ where: { chatRoomId }, orderBy: { createdAt: "asc" } }),
    db.decision.findMany({ where: { chatRoomId }, orderBy: { createdAt: "asc" } }),
    db.agentDisagreement.findMany({ where: { chatRoomId }, orderBy: { createdAt: "asc" } }),
    db.approvalRequest.findMany({ where: { chatRoomId }, orderBy: { createdAt: "asc" } }),
    db.agentSession.findMany({ where: { chatRoomId }, orderBy: { lastActivityAt: "desc" } }),
    db.collaborationEvent.aggregate({ where: { chatRoomId }, _max: { sequence: true } }),
  ]);

  const sessionByAgent = new Map<string, (typeof sessions)[number]>();
  for (const session of sessions) {
    if (!sessionByAgent.has(session.agentId)) sessionByAgent.set(session.agentId, session);
  }

  const participants: CollaborationParticipant[] = room.agentIds.map((agentId) => {
    const vpsAgent = getVpsAgent(agentId);
    const session = sessionByAgent.get(agentId);
    const activeTask = tasks.find((task) => task.agentId === agentId && ACTIVE_TASK_STATUSES.has(task.status));
    return {
      agentId,
      name: vpsAgent?.name ?? agentId,
      runtime: vpsAgent?.kind ?? "unknown",
      model: vpsAgent?.model ?? "unknown",
      role: resolveDisplayRole(vpsAgent?.kind ?? "custom"),
      status: session?.status ?? "idle",
      activeTaskId: activeTask?.id,
      health: participantHealth(session?.status),
      lastActivityAt: (session?.lastActivityAt ?? room.createdAt).toISOString(),
    };
  });

  const artifactIdsByTask = new Map<string, string[]>();
  for (const artifact of artifacts) {
    if (!artifact.taskId) continue;
    const list = artifactIdsByTask.get(artifact.taskId) ?? [];
    list.push(artifact.id);
    artifactIdsByTask.set(artifact.taskId, list);
  }

  return {
    roomId: room.id,
    roomName: room.name,
    objective: room.objective,
    mode: room.mode,
    autonomyLevel: room.autonomyLevel,
    participants,
    tasks: tasks.map((task) => ({
      id: task.id,
      title: task.title,
      description: task.description ?? undefined,
      status: task.status as CollaborationTask["status"],
      ownerAgentId: task.agentId ?? undefined,
      reviewerAgentId: task.reviewerAgentId ?? undefined,
      createdByAgentId: task.createdByAgentId ?? undefined,
      dependsOnTaskIds: task.dependsOnTaskIds,
      artifactIds: artifactIdsByTask.get(task.id) ?? [],
    })),
    messages: messages.map((message) => ({
      id: message.id,
      roomId: message.chatRoomId,
      senderAgentId: message.agentId ?? "user",
      recipientAgentIds: message.recipientAgentIds,
      type: message.messageType as AgentMessage["type"],
      taskId: message.taskId ?? undefined,
      artifactIds: message.artifactIds,
      content: message.content,
      createdAt: message.createdAt.toISOString(),
    })),
    artifacts: artifacts.map((artifact) => ({
      id: artifact.id,
      type: artifact.type as CollaborationArtifact["type"],
      title: artifact.title,
      taskId: artifact.taskId ?? undefined,
      createdByAgentId: artifact.createdBy,
      createdAt: artifact.createdAt.toISOString(),
    })),
    decisions: decisions.map((decision) => ({
      id: decision.id,
      decision: decision.title,
      reason: decision.summary,
      proposedByAgentId: decision.createdBy,
      acceptedByAgentId: decision.approvedBy ?? undefined,
      relatedTaskIds: decision.relatedTaskIds,
      createdAt: decision.createdAt.toISOString(),
    })),
    disagreements: disagreements.map((disagreement) => ({
      id: disagreement.id,
      taskId: disagreement.taskId ?? undefined,
      issue: disagreement.issue,
      positions: Array.isArray(disagreement.positions) ? (disagreement.positions as AgentDisagreement["positions"]) : [],
      severity: disagreement.severity as AgentDisagreement["severity"],
      resolvedByAgentId: disagreement.resolvedByAgentId ?? undefined,
      finalDecision: disagreement.finalDecision ?? undefined,
    })),
    approvals: approvals.map((approval) => {
      const payload = (approval.payload ?? {}) as Record<string, unknown>;
      return {
        id: approval.id,
        title: approval.title,
        command: typeof payload.command === "string" ? payload.command : "",
        environment: typeof payload.environment === "string" ? payload.environment : "workspace",
        risk: approval.risk as "low" | "medium" | "high",
        requestedByAgentId: approval.requesterAgentId ?? "unknown",
        status: approval.status === "approved" ? "approved" : approval.status === "rejected" ? "denied" : "pending",
      };
    }),
    lastEventSequence: lastEvent._max.sequence ?? 0,
  };
}
