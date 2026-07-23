export type DataFreshness = "live" | "mixed" | "mock";
export type OperationalStatus = "online" | "busy" | "idle" | "offline" | "error";
export type Severity = "critical" | "high" | "medium" | "low";
export type AttentionAction = "approve" | "reject" | "open" | "review";
export type ContinueItemType = "project" | "conversation" | "file" | "workspace";
export type FeedScope = "all" | "agents" | "projects" | "workspaces" | "system" | "organization";

export interface MissionSummaryMetric {
  id: string;
  label: string;
  value: number;
  detail: string;
  tone: "critical" | "warning" | "positive" | "neutral";
  actionLabel: string;
  href: string;
}

export interface ContinueItem {
  id: string;
  type: ContinueItemType;
  title: string;
  context: string;
  lastActivity: string;
  status: string;
  href: string;
}

export interface AttentionItem {
  id: string;
  title: string;
  detail: string;
  category: "approval" | "job" | "decision" | "memory" | "task" | "permission" | "deployment" | "security";
  severity: Severity;
  owner: string;
  source: string;
  timestamp: string;
  actions: AttentionAction[];
}

export interface AgentOperation {
  id: string;
  name: "Hermes Lisa" | "Claude Code" | "Codex" | "OpenClaw";
  role: string;
  status: OperationalStatus;
  model: string;
  currentTask: string;
  context: string;
  progress: number | null;
  voiceState: "listening" | "speaking" | "silent" | "unavailable";
  health: {
    cpu: number | null;
    memory: string;
    runtime: string;
  };
  costToday: number;
  href: string;
}

export interface MissionFeedItem {
  id: string;
  scope: Exclude<FeedScope, "all">;
  event: string;
  actor: string;
  source: string;
  timestamp: string;
  tone: "positive" | "warning" | "critical" | "neutral" | "accent";
  href: string;
}

export interface HealthItem {
  id: string;
  label: string;
  status: "healthy" | "degraded" | "down" | "active";
  value: string;
  detail: string;
  utilization?: number;
}

export interface NeuralPreviewData {
  workspace: string;
  project: string;
  repository: string;
  branch: string;
  activeAgentIds: string[];
  nodes: Array<{ id: string; label: string; kind: "focus" | "agent" | "decision" | "memory" | "task" }>;
  edges: Array<{ from: string; to: string }>;
  counts: { decisions: number; memories: number; tasks: number; blocked: number };
}

export interface MissionContextLevel {
  id: "organization" | "workspace" | "project" | "team" | "scope";
  label: string;
  value: string;
  options: string[];
}

export interface QuickAction {
  id: string;
  label: string;
  href: string;
  icon: "project" | "chat" | "voice" | "task" | "invite" | "studio" | "module" | "approval";
}

export interface MissionControlData {
  greetingName: string;
  operationalSummary: string;
  generatedAt: string;
  freshness: DataFreshness;
  stale: boolean;
  context: MissionContextLevel[];
  summaryMetrics: MissionSummaryMetric[];
  continueItems: ContinueItem[];
  attention: AttentionItem[];
  agents: AgentOperation[];
  feed: MissionFeedItem[];
  health: HealthItem[];
  neural: NeuralPreviewData;
  quickActions: QuickAction[];
  liveSources: string[];
  mockedSources: string[];
}

export interface MissionControlService {
  load(signal?: AbortSignal): Promise<MissionControlData>;
  resolveAttention(id: string, action: AttentionAction): Promise<{ ok: boolean }>;
}
