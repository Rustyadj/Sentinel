export type TaskStatus =
  | "PLANNED" | "QUEUED" | "CLAIMED" | "RUNNING" | "BLOCKED"
  | "WAITING_REVIEW" | "CHANGES_REQUESTED" | "APPROVAL_REQUIRED"
  | "COMPLETED" | "FAILED" | "CANCELLED";

export type AgentRole = "lead" | "implementation" | "review" | "research";

export type AgentHealth =
  | "CONNECTED" | "IDLE" | "BUSY" | "DEGRADED" | "DISCONNECTED" | "FAILED";

export type AgentMessageType =
  | "MESSAGE" | "DELEGATION" | "REVIEW_REQUEST" | "QUESTION" | "ANSWER"
  | "BLOCKER" | "DECISION" | "RESULT" | "CHANGES_REQUESTED";

export interface AgentMessage {
  id: string;
  roomId: string;
  senderAgentId: string | "user";
  recipientAgentIds: string[];
  type: AgentMessageType;
  taskId?: string;
  artifactIds?: string[];
  content: string;
  createdAt: string;
}

export interface CollaborationTask {
  id: string;
  title: string;
  description?: string;
  status: TaskStatus;
  ownerAgentId?: string;
  reviewerAgentId?: string;
  createdByAgentId?: string;
  dependsOnTaskIds: string[];
  artifactIds: string[];
}

export interface CollaborationParticipant {
  agentId: string;
  name: string;
  runtime: string;
  model: string;
  role: AgentRole;
  status: string;
  activeTaskId?: string;
  health: AgentHealth;
  tokenUsage?: { tokens: number; costUsd: number };
  lastActivityAt: string;
}

export type CollaborationArtifactType =
  | "code_diff" | "plan" | "research" | "test_report" | "review"
  | "terminal_output" | "architecture" | "document" | "image"
  | "dataset" | "decision";

export interface CollaborationArtifact {
  id: string;
  type: CollaborationArtifactType;
  title: string;
  taskId?: string;
  createdByAgentId?: string;
  createdAt: string;
}

export interface AgentDisagreement {
  id: string;
  taskId?: string;
  issue: string;
  positions: { agentId: string; position: string; evidence?: string }[];
  severity: "low" | "medium" | "high";
  resolvedByAgentId?: string;
  finalDecision?: string;
}

export interface CollaborationDecision {
  id: string;
  decision: string;
  reason: string;
  proposedByAgentId: string;
  acceptedByAgentId?: string;
  relatedTaskIds: string[];
  createdAt: string;
}

export type CollaborationEventType =
  | "room.created" | "agent.joined" | "agent.started" | "agent.finished"
  | "agent.failed" | "task.created" | "task.claimed" | "task.started"
  | "task.blocked" | "task.completed" | "task.review_requested"
  | "task.review_failed" | "task.approved" | "artifact.created"
  | "artifact.modified" | "decision.created" | "execution.started"
  | "execution.output" | "execution.finished" | "approval.requested"
  | "approval.granted" | "approval.denied" | "objective.completed";

export interface CollaborationEvent {
  type: CollaborationEventType;
  roomId: string;
  payload: Record<string, unknown>;
  occurredAt: string;
}

export type CollaborationMode = "solo" | "collaborative" | "autonomous";
