export const MEMORY_CANDIDATE_TYPES = [
  "fact", "preference", "decision", "lesson", "procedure", "policy",
  "relationship", "correction", "summary",
] as const;

export const MEMORY_SOURCE_TYPES = [
  "explicit_user_statement", "human_correction", "agent_inference",
  "tool_output", "external_document", "email", "web", "workflow",
  "evaluation", "import",
] as const;

export type MemoryCandidateType = (typeof MEMORY_CANDIDATE_TYPES)[number];
export type MemorySourceType = (typeof MEMORY_SOURCE_TYPES)[number];
export type MemoryCandidateStatus =
  | "pending" | "auto_approved" | "approved" | "rejected"
  | "quarantined" | "expired" | "rolled_back";

export interface MemoryProvenance {
  sourceIds: string[];
  evidenceIds: string[];
  sourceUri?: string;
  sourceAuthor?: string;
  capturedAt: string;
}

export interface ProposeMemoryCandidateInput {
  organizationId?: string;
  workspaceId?: string;
  projectId?: string;
  userId?: string;
  agentId?: string;
  runId?: string;
  conversationId?: string;
  candidateType: MemoryCandidateType;
  content: string;
  structuredPayload?: Record<string, unknown>;
  sourceType: MemorySourceType;
  sourceTrust: number;
  confidence: number;
  importance: number;
  risk: number;
  provenance: MemoryProvenance;
  expiresAt?: string;
  reviewAt?: string;
  supersedesId?: string;
  contradictsIds?: string[];
  proposedBy: string;
}

export interface ActiveMemoryCard {
  actingUser: { id: string; preferences: string[] };
  agent: { id: string; role: string; toolRestrictions: string[] };
  organization?: { id: string; name: string };
  workspace?: { id: string; name: string };
  project?: { id: string; name: string };
  objective: string;
  activeDecisions: Array<{ id: string; title: string; summary: string }>;
  constraints: string[];
  criticalPolicies: Array<{ id: string; name: string; description: string }>;
  approvalRequirements: string[];
}

export const ADAPTIVE_EVENT_TYPES = [
  "memory.candidate_created", "memory.approved", "memory.rejected",
  "memory.superseded", "memory.expired", "memory.quarantined", "memory.recalled",
  "retrieval.started", "retrieval.completed", "retrieval.item_selected", "retrieval.item_rejected",
  "reflection.completed", "consolidation.completed", "skill.candidate_created",
  "skill.test_started", "skill.test_completed", "skill.approved", "skill.activated",
  "skill.degraded", "skill.rolled_back", "skill.retired", "workflow.proposed",
  "workflow.activated", "workflow.failed", "workflow.disabled", "mcp.client_connected",
  "mcp.client_disconnected", "mcp.tool_called", "mcp.tool_failed",
  "mcp.authorization_denied", "agent.delegated", "agent.run_started",
  "agent.run_completed", "agent.run_failed",
] as const;
export type AdaptiveEventType = (typeof ADAPTIVE_EVENT_TYPES)[number];
