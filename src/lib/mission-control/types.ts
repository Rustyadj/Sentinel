export type DataState = "live" | "stale" | "unavailable" | "demo";
export type OperationalStatus = "online" | "busy" | "idle" | "offline" | "error";
export type Severity = "critical" | "high" | "medium" | "low";
export type AttentionAction = "approve" | "reject" | "open" | "review";
export type ContinueItemType = "project" | "conversation" | "file" | "workspace";
export type FeedScope = "all" | "agents" | "projects" | "workspaces" | "system" | "organization";
export type MissionSection = "summary" | "continue" | "attention" | "agents" | "feed" | "health" | "neural" | "context";

export interface DataSourceState {
  state: DataState;
  source: string;
  observedAt: string | null;
  reason?: string;
}

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
  targetId: string;
  targetType: "approval" | "learning-candidate" | "task";
  href: string;
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
  name: string;
  role: string;
  status: OperationalStatus;
  model: string;
  currentTask: string | null;
  context: string | null;
  progress: number | null;
  voiceState: "listening" | "speaking" | "silent" | "unavailable";
  health: { cpu: number | null; memory: string | null; runtime: string | null };
  costToday: number | null;
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
  status: "healthy" | "degraded" | "down" | "active" | "unavailable";
  value: string;
  detail: string;
  utilization?: number;
}

export interface NeuralPreviewData {
  workspace: string | null;
  project: string | null;
  repository: string | null;
  branch: string | null;
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
  sources: Record<MissionSection, DataSourceState>;
  context: MissionContextLevel[];
  summaryMetrics: MissionSummaryMetric[];
  continueItems: ContinueItem[];
  attention: AttentionItem[];
  agents: AgentOperation[];
  feed: MissionFeedItem[];
  health: HealthItem[];
  neural: NeuralPreviewData;
  quickActions: QuickAction[];
}

export interface MissionControlService {
  load(signal?: AbortSignal): Promise<MissionControlData>;
  resolveAttention(item: AttentionItem, action: AttentionAction): Promise<{ ok: true }>;
}
