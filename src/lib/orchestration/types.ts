export type OrchestrationMode = "sync" | "async";
export type OrchestrationTaskType = "coding" | "review" | "debugging" | "planning" | "research" | "support" | "construction" | "estimating";

export interface RouteTaskInput {
  task: string;
  mode?: OrchestrationMode;
  projectHint?: string;
  workspaceHint?: string;
  projectId?: string;
  workspaceId?: string;
  /** Reuse the permitted context of an earlier durable Sentinel task. */
  contextTaskId?: string;
  preferredAgentId?: string;
  taskType?: OrchestrationTaskType;
  idempotencyKey?: string;
  /** Explicit override is audited and is required to bypass worker co-execution policy. */
  explicitUserOverride?: boolean;
}

export interface ResolvedScope {
  workspaceId: string | null;
  workspaceName: string | null;
  projectId: string | null;
  projectName: string | null;
  resolution: "explicit" | "context" | "inferred" | "single" | "none";
}

export interface RoutingDecision {
  agentId: string;
  score: number;
  reasons: string[];
  taskType: OrchestrationTaskType;
}
