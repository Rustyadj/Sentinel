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
  | "Message"
  // Learning Core (see docs/LEARNING_CORE_ON_NEURAL_ENGINE.md) — additive.
  // Distinct node types per the spec's "Learning Graph Integration" even
  // though several share one backing table (LearningCandidate covers
  // hypothesis/improvement_proposal/experiment) — the graph's "type" is a
  // display/categorization concept, not required to be 1:1 with a model.
  | "CuriosityEvent"
  | "Reflection"
  | "KnowledgeGap"
  | "LearningGoal"
  | "LearningCandidate"
  | "Benchmark"
  | "TrustEvent"
  | "Failure"
  | "Lesson"
  // Governed Evolutionary Self-Improvement (see docs/LEARNING_CORE_EVOLUTION.md)
  // — additive, same "graph type is a display concept, not 1:1 with a model"
  // rule as the Learning Core block above.
  | "EvalCase"
  | "EvalSuite"
  | "GuardianDecision"
  | "Principle"
  | "AdversarialRun";

export type KnowledgeEdgeType =
  | "references"
  | "belongs_to"
  | "created_by"
  | "assigned_to"
  | "reviewed_by"
  | "generated_by"
  | "depends_on"
  | "remembers"
  | "related_to"
  | "supersedes"
  // Learning Core — additive
  | "triggered_by"
  | "learned_from"
  | "supports"
  | "contradicts"
  | "tests"
  | "improves"
  | "replaced_by"
  | "rolled_back_to"
  | "approved_by"
  | "affects_agent"
  | "affects_workspace"
  | "created_skill"
  | "resolved_gap"
  | "derived_from_trace"
  // Governed Evolutionary Self-Improvement — additive. `rolled_back_to`,
  // `supports`, and `contradicts` above already cover two of the spec's
  // requested relationship names; these are the genuinely new ones.
  | "descended_from"
  | "competes_with"
  | "evaluated_by"
  | "failed_on"
  | "passed"
  | "promoted_to"
  | "distilled_from"
  | "protected_by"
  | "attacked_by";

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
  // Continual memory — additive, same convention as the Phase A entries above.
  | "memory.superseded"
  | "memory.consolidated"
  | "memory.decayed"
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
  /** Owning workspace, when this object belongs to one — used to group/color related nodes in the graph. */
  workspaceId?: string;
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
  projectId?: string;
  sourceMessageIds?: string[];
  metadata: Record<string, unknown>;
}

export interface RetrievalContext {
  /**
   * What the caller is actually asking about.
   *
   * Optional for backward compatibility: callers that omit it get the previous
   * value-ordered top-N. Callers that supply it get memories ranked against
   * the question instead of against the clock. Every agent-facing surface
   * should supply it -- without it, retrieval cannot tell a relevant memory
   * from a recent one.
   */
  query?: string;
  projectId?: string;
  workspaceId?: string;
  organizationId?: string;
  userId: string;
  roomId?: string;
  maxItems?: number;
  scopePolicy?: "isolated" | "user-context";
  /** Links this retrieval to the work it fed, so usefulness can be resolved later. */
  experienceId?: string;
  /**
   * Suppress the usage write inside retrieveContextWithProvenance.
   *
   * Set by buildMemoryContext (src/lib/neural-engine/memory-context.ts), which
   * records usage itself *after* assembling the prompt block — that is the only
   * point at which it is known which memories were actually injected rather
   * than merely retrieved. Without this the batch would be written twice, once
   * with every `injected` flag wrongly false.
   */
  skipUsageRecording?: boolean;
}
