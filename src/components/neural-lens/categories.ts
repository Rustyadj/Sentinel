// Neural Lens — node category → cluster taxonomy (Phase E: OS-scale graph).
//
// Every entity Sentinel tracks belongs to exactly one category, and every
// category belongs to exactly one cluster. Clusters are the ~10 large
// regions that stay visible even zoomed all the way out; categories drive
// per-node styling (accent color, hub eligibility) within a cluster.

export type ClusterId =
  | "Chat"
  | "Projects"
  | "Knowledge"
  | "Memory"
  | "Learning"
  | "Cybersecurity"
  | "Coding"
  | "Organization"
  | "Infrastructure"
  | "Voice";

export const CLUSTER_IDS: ClusterId[] = [
  "Chat",
  "Projects",
  "Knowledge",
  "Memory",
  "Learning",
  "Cybersecurity",
  "Coding",
  "Organization",
  "Infrastructure",
  "Voice",
];

export type NodeCategory =
  | "Workspace"
  | "Project"
  | "Conversation"
  | "Message"
  | "Memory"
  | "Knowledge"
  | "Workflow"
  | "WorkflowRun"
  | "Agent"
  | "Runtime"
  | "Model"
  | "Provider"
  | "Repository"
  | "Branch"
  | "Commit"
  | "File"
  | "Goal"
  | "Task"
  | "Approval"
  | "Skill"
  | "Experiment"
  | "LearningEvent"
  | "CyberAsset"
  | "Detection"
  | "Campaign"
  | "Threat"
  | "Organization";

/** Every category's home cluster. Hub-eligible categories (org/workspace-ish
 * anchors) are called out separately in HUB_CATEGORIES below. */
export const CATEGORY_CLUSTER: Record<NodeCategory, ClusterId> = {
  Conversation: "Chat",
  Message: "Chat",

  Project: "Projects",
  Goal: "Projects",
  Task: "Projects",
  Approval: "Projects",

  Knowledge: "Knowledge",
  File: "Knowledge",

  Memory: "Memory",

  Workflow: "Learning",
  WorkflowRun: "Learning",
  Skill: "Learning",
  Experiment: "Learning",
  LearningEvent: "Learning",

  CyberAsset: "Cybersecurity",
  Detection: "Cybersecurity",
  Campaign: "Cybersecurity",
  Threat: "Cybersecurity",

  Repository: "Coding",
  Branch: "Coding",
  Commit: "Coding",

  Organization: "Organization",
  Agent: "Organization",

  Workspace: "Infrastructure",
  Runtime: "Infrastructure",
  Model: "Infrastructure",
  Provider: "Infrastructure",

  // No dedicated Voice category yet on the data side — voice sessions are
  // Conversations under the hood — but the cluster exists so the graph has a
  // place for it the moment voice-session nodes ship.
};

/** Categories large/structural enough to become hub nodes (bigger radius,
 * soft glow, other nodes fan out from them) rather than leaf nodes. */
export const HUB_CATEGORIES = new Set<NodeCategory>([
  "Workspace",
  "Project",
  "Conversation",
  "Organization",
  "Repository",
  "Agent",
  "Runtime",
]);

export function clusterOf(category: string): ClusterId {
  return CATEGORY_CLUSTER[category as NodeCategory] ?? "Infrastructure";
}

export function isHubCategory(category: string): boolean {
  return HUB_CATEGORIES.has(category as NodeCategory);
}

/** Where "Open module" (double-click / context menu) navigates to for a
 * node in this cluster — the real Sentinel module that owns this kind of
 * entity, not a graph-specific view. */
export const CLUSTER_ROUTE: Record<ClusterId, string> = {
  Chat: "/chat",
  Projects: "/projects",
  Knowledge: "/memory",
  Memory: "/memory",
  Learning: "/learning",
  Cybersecurity: "/security",
  Coding: "/projects",
  Organization: "/orgchart",
  Infrastructure: "/settings",
  Voice: "/chat",
};

export function routeForCluster(cluster: ClusterId): string {
  return CLUSTER_ROUTE[cluster] ?? "/dashboard";
}
