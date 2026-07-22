// Knowledge Engine — domain types
// No imports from sibling files.

export type KnowledgeObjectType =
  | "Note"
  | "Memory"
  | "Project"
  | "Workspace"
  | "Agent"
  | "Person"
  | "Organization"
  | "Task"
  | "Decision"
  | "Workflow"
  | "File"
  | "Repository"
  | "Module"
  | "Artifact"
  | "Conversation"
  | "Message";

export type KnowledgeEdgeType =
  | "references"
  | "belongs_to"
  | "created_by"
  | "assigned_to"
  | "generated_by"
  | "depends_on"
  | "remembers"
  | "related_to"
  | "supersedes";

export type KnowledgeScope =
  | "session"
  | "project"
  | "workspace"
  | "organization"
  | "user"
  | "global";

export type DecisionStatus =
  | "proposed"
  | "approved"
  | "rejected"
  | "superseded";

export type KnowledgeEventType =
  | "object_created"
  | "object_updated"
  | "edge_created"
  | "candidate_proposed"
  | "candidate_accepted"
  | "candidate_rejected"
  // Sentinel Neural Engine (Phase A) — additive. KnowledgeEvent.type stays a
  // plain string column (see docs/neural-engine/PHASE_A_CONFLICTS.md); this
  // union is the only place the allowed event vocabulary is enumerated.
  | "experience.started"
  | "experience.completed"
  | "outcome.created"
  | "evaluation.completed"
  | "learning.proposed"
  | "learning.approved"
  | "learning.rejected"
  | "learning.rolled_back"
  | "edge.strengthened"
  | "edge.weakened"
  | "contradiction.detected"
  | "contradiction.resolved"
  | "skill.promoted";

export interface KnowledgeNode {
  id: string;
  type: KnowledgeObjectType;
  title: string;
  summary?: string;
  scope: KnowledgeScope;
  metadata: Record<string, unknown>;
  createdAt: Date;
}

export interface KnowledgeEdge {
  id: string;
  fromObjectId: string;
  toObjectId: string;
  type: KnowledgeEdgeType;
  weight: number;
  metadata: Record<string, unknown>;
}

export interface GraphData {
  nodes: KnowledgeNode[];
  edges: KnowledgeEdge[];
}

export interface ApprovalEvent {
  actorId: string;
  action: "approved" | "rejected" | "proposed" | "superseded";
  note?: string;
  at: string; // ISO timestamp
}

export interface DecisionRecord {
  id: string;
  title: string;
  summary: string;
  status: DecisionStatus;
  rationale?: string;
  alternatives: string[];
  sourceLinks: string[];
  approvalHistory: ApprovalEvent[];
  createdBy: string;
  approvedBy?: string;
  supersedesDecisionId?: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface ExtractionCandidate {
  id: string; // local ephemeral id, not DB
  candidateType: "memory" | "decision" | "task" | "entity" | "link";
  title: string;
  summary: string;
  confidence: number;
  sourceRoomId?: string;
  sourceMessageIds?: string[];
  metadata: Record<string, unknown>;
}

export interface RetrievalContext {
  projectId?: string;
  workspaceId?: string;
  organizationId?: string;
  userId?: string;
  roomId?: string;
  maxItems?: number;
}
