export type CoreModuleId =
  | "dashboard"
  | "chat"
  | "agents"
  | "obsidian"
  | "builder"
  | "security"
  | "workflows"
  | "kanban"
  | "orgchart"
  | "marketing"
  | "settings";

export type ModuleId = CoreModuleId | string;

export interface NavModule {
  id: ModuleId;
  label: string;
  icon: string;
  href: string;
  description: string;
}

export type AgentStatus = "online" | "busy" | "idle" | "offline";

export interface Agent {
  id: string;
  name: string;
  role: string;
  avatar: string;
  color: string;
  description: string;
  skills: string[];
  reasoningEffort?: string | null;
  model: string;
  status: AgentStatus;
  systemPrompt?: string;
  toolPermissions?: string[];
  memoryScope?: "session" | "project" | "org";
}

export type MessageRole = "user" | "agent" | "system";

export interface Message {
  id: string;
  chatId: string;
  role: MessageRole;
  agentId?: string;
  agentName?: string;
  agentColor?: string;
  agentAvatar?: string;
  content: string;
  timestamp: Date;
  toolCalls?: ToolCall[];
  reasoning?: string;
  isStreaming?: boolean;
}

export interface ToolCall {
  id: string;
  name: string;
  input: Record<string, unknown>;
  output?: string;
  status: "pending" | "running" | "complete" | "error";
}

export interface ChatRoom {
  id: string;
  name: string;
  agents: string[];
  messages: Message[];
  createdAt: Date;
  projectId?: string;
}

export type MemoryType =
  | "decision"
  | "preference"
  | "fact"
  | "workflow"
  | "pattern"
  | "instruction";

export type MemoryScope =
  | "session"
  | "project"
  | "agent"
  | "org"
  | "obsidian";

export interface Memory {
  id: string;
  type: MemoryType;
  scope: MemoryScope;
  owner: string;
  content: string;
  tags: string[];
  confidence: number;
  importanceScore: number;
  source: string;
  createdAt: Date;
  updatedAt: Date;
  pinned?: boolean;
  archived?: boolean;
}

export interface Project {
  id: string;
  name: string;
  description: string;
  status: "active" | "paused" | "completed" | "archived";
  agents: string[];
  createdAt: Date;
  updatedAt: Date;
  tags: string[];
}

export interface KanbanColumn {
  id: string;
  title: string;
  color: string;
  cards: KanbanCard[];
}

export interface KanbanCard {
  id: string;
  title: string;
  description?: string;
  priority: "low" | "medium" | "high" | "urgent";
  assignee?: string;
  dueDate?: Date;
  tags: string[];
}

export interface WorkflowNode {
  id: string;
  type:
    | "trigger"
    | "agent"
    | "http"
    | "email"
    | "database"
    | "approval"
    | "condition"
    | "loop"
    | "webhook";
  label: string;
  position: { x: number; y: number };
  config: Record<string, unknown>;
}

export interface Workflow {
  id: string;
  name: string;
  description: string;
  nodes: WorkflowNode[];
  edges: Array<{ from: string; to: string }>;
  status: "draft" | "active" | "paused";
  createdAt: Date;
}
