// Wire types shared by the Orrery activity API and its client. Every field is
// derived from a persisted Sentinel row; nothing here is simulated.

export type OrreryVerb = "read" | "recall" | "write" | "exec" | "wait" | "start" | "done" | "fail";

export interface OrreryEvent {
  /** Stable per source row, so a client can de-duplicate across polls. */
  id: string;
  at: string;
  agentId: string;
  verb: OrreryVerb;
  text: string;
  /** KnowledgeObject ids this event touched. Empty when it touched none. */
  nodeIds: string[];
}

export interface OrreryAgentState {
  agentId: string;
  state: "working" | "idle";
  /** KnowledgeObject id of the agent's own graph node, when it has one. */
  nodeId: string | null;
}

export interface OrreryRun {
  id: string;
  kind: "session" | "run";
  agentId: string;
  status: string;
  title: string;
  startedAt: string;
  /** Most recent events for this run, newest first. */
  recent: Array<{ at: string; verb: OrreryVerb; text: string }>;
  /** Present for sessions: where the full session lives. */
  sessionId?: string;
}

export interface OrreryApproval {
  id: string;
  workspaceId: string;
  title: string;
  type: string;
  risk: string;
  requesterAgentId: string | null;
  description: string | null;
  createdAt: string;
}

export interface OrreryActivity {
  /**
   * ISO instant to pass back as `since` on the next poll. It deliberately lags the
   * clock (rows can commit after the instant they are stamped with) and stops at the
   * last row returned when a source hit its cap, so a busy window is paged through
   * rather than skipped. Boundary rows are sent again; clients de-duplicate on id.
   */
  cursor: string;
  /** True when a source hit its row cap and older, still-unseen rows may remain behind `cursor`. */
  truncated: boolean;
  events: OrreryEvent[];
  agents: OrreryAgentState[];
  runs: OrreryRun[];
  approvals: OrreryApproval[];
}
