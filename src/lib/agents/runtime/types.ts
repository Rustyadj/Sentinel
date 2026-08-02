export type AgentRuntimeKind = "hermes" | "openclaw" | "claude-code" | "codex";
export type RuntimeTransport = "http" | "process" | "docker" | "systemd";

export interface RuntimeLogSource {
  kind: "docker" | "file" | "http";
  ref: string;
}

export interface RuntimeInstance {
  id: string;
  agentId: string;
  kind: AgentRuntimeKind;
  transport: RuntimeTransport;
  endpoint?: string;
  containerName?: string;
  serviceName?: string;
  executable?: string;
  args?: string[];
  workingDirectoryRoot?: string;
  configPath?: string;
  logSource?: RuntimeLogSource;
}

export interface RuntimeDiscovery {
  found: boolean;
  kind: AgentRuntimeKind;
  instances: RuntimeInstance[];
  reason?: string;
}

export interface RuntimeHealth {
  installed: boolean;
  processRunning: boolean;
  reachable: boolean;
  authenticated: boolean | null;
  ready: boolean;
  busy: boolean;
  degraded: boolean;
  version?: string;
  currentSessionId?: string;
  failureCode?: string;
  message?: string;
  checkedAt: string;
}

export interface RuntimeReadiness {
  ready: boolean;
  reason?: string;
}

export interface StartSessionInput {
  runtimeId: string;
  userId: string;
  workspaceId?: string;
  projectId?: string;
  workingDirectory?: string;
  initialPrompt?: string;
}

export interface ResumeSessionInput {
  runtimeId: string;
  externalSessionId: string;
  userId: string;
}

export type AgentSessionStatus =
  | "created"
  | "ready"
  | "running"
  | "completed"
  | "failed"
  | "cancelled"
  | "timed_out";

export interface AgentSession {
  id: string;
  runtime: AgentRuntimeKind;
  runtimeInstanceId: string;
  externalSessionId?: string;
  agentId: string;
  userId: string;
  workspaceId?: string;
  projectId?: string;
  workingDirectory?: string;
  status: AgentSessionStatus;
  startedAt: string;
  lastActivityAt: string;
  completedAt?: string;
  exitCode?: number;
  cancelledAt?: string;
  metadata: Record<string, unknown>;
  parentSessionId?: string;
}

export interface SendTaskInput {
  sessionId: string;
  prompt: string;
  userId: string;
}

export type RuntimeEventType =
  | "session_started"
  | "status"
  | "stdout"
  | "stderr"
  | "assistant_delta"
  | "tool_started"
  | "tool_completed"
  | "approval_required"
  | "file_changed"
  | "command_started"
  | "command_completed"
  | "warning"
  | "error"
  | "delegated"
  | "cancelled"
  | "completed";

export type RuntimeEvent = {
  [K in RuntimeEventType]: {
    type: K;
    sessionId: string;
    sequence: number;
    timestamp: string;
    data: Record<string, unknown>;
  }
}[RuntimeEventType];

export interface RuntimeActionResult {
  success: boolean;
  message?: string;
}

export interface SessionQuery {
  runtimeId?: string;
  userId?: string;
  workspaceId?: string;
  status?: string;
  limit?: number;
}

export interface RuntimeLogQuery {
  sessionId: string;
  since?: string;
  limit?: number;
}

export interface RuntimeLogPage {
  lines: string[];
  hasMore: boolean;
}

export interface RuntimeCapabilitySupport {
  supported: boolean;
  reason?: string;
}

export interface RuntimeCapabilities {
  streaming: boolean;
  resume: boolean;
  cancel: boolean;
  toolEvents: boolean;
  fileChangeEvents: boolean;
  restart?: RuntimeCapabilitySupport;
  reload?: RuntimeCapabilitySupport;
  nativeUi?: RuntimeCapabilitySupport;
}

export interface AgentRuntimeAdapter {
  kind: AgentRuntimeKind;
  discover(): Promise<RuntimeDiscovery>;
  health(runtime: RuntimeInstance): Promise<RuntimeHealth>;
  readiness(runtime: RuntimeInstance): Promise<RuntimeReadiness>;
  startSession(input: StartSessionInput): Promise<AgentSession>;
  resumeSession(input: ResumeSessionInput): Promise<AgentSession>;
  send(input: SendTaskInput): AsyncIterable<RuntimeEvent>;
  cancel(sessionId: string): Promise<RuntimeActionResult>;
  getSession(sessionId: string): Promise<AgentSession | null>;
  listSessions(query: SessionQuery): Promise<AgentSession[]>;
  getLogs(query: RuntimeLogQuery): Promise<RuntimeLogPage>;
  restart(runtimeId: string): Promise<RuntimeActionResult>;
  reload(runtimeId: string): Promise<RuntimeActionResult>;
  capabilities(runtime: RuntimeInstance): Promise<RuntimeCapabilities>;
}

export type SentinelControlStatus = "verified" | "partial" | "unavailable";

export interface RuntimeView extends RuntimeInstance {
  workspaceId?: string;
  enabled: boolean;
  capabilities: RuntimeCapabilities;
  sentinelControl: SentinelControlStatus;
  nativeUiUrl?: string;
  model?: string;
}

export type RuntimeOperationalState =
  | "online"
  | "busy"
  | "idle"
  | "thinking"
  | "streaming"
  | "error"
  | "offline";

export interface RuntimeOperationalStatus {
  runtimeId: string;
  agentId: string;
  kind: AgentRuntimeKind;
  state: RuntimeOperationalState;
  provider: string;
  model: string | null;
  version: string | null;
  health: RuntimeHealth;
  currentSession: AgentSession | null;
  currentTask: string | null;
  workspace: { id: string; name: string } | null;
  project: { id: string; name: string } | null;
  lastActivityAt: string | null;
  sessionUptimeSeconds: number | null;
  runtimeUptimeSeconds: number | null;
  memoryBytes: number | null;
  queueDepth: number | null;
  latestEventType: RuntimeEventType | null;
  unavailableFields: Array<
    | "runtimeUptime"
    | "memory"
    | "queueDepth"
    | "model"
    | "sessions"
    | "currentTask"
    | "workspace"
    | "project"
  >;
}
