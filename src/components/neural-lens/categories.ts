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
  | "Marketing"
  | "Voice"
  | "External";

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
  "Marketing",
  "Voice",
  "External",
];

/**
 * The cluster laid out as the dense core at the centre of the globe rather
 * than as a cap on the shell. Agents sit at the middle of Sentinel's graph
 * because everything else is something an agent reads, writes, or acts on —
 * so the active agent's node is the seat the camera frames by default.
 */
export const CORE_CLUSTER_ID: ClusterId = "Organization";

/**
 * Region names drawn on the globe and used as the cluster's display name in
 * the layer rail. These are presentation only — `ClusterId` stays the stable
 * key that layout positions, routes, and persisted lens state are keyed on.
 */
export const CLUSTER_LABEL: Record<ClusterId, string> = {
  Chat: "Communications",
  Projects: "Projects",
  Knowledge: "Data Lake",
  Memory: "Memory Core",
  Learning: "Workflows Engine",
  Cybersecurity: "Cybersecurity Operations",
  Coding: "Code Repositories",
  Organization: "Agents",
  Infrastructure: "Infrastructure",
  Marketing: "Marketing Operations",
  Voice: "Voice",
  External: "External Partners",
};

/** Compact form for dense chrome (layer rows, legend, status readouts). */
export const CLUSTER_SHORT_LABEL: Record<ClusterId, string> = {
  Chat: "Communications",
  Projects: "Projects",
  Knowledge: "Knowledge",
  Memory: "Memory",
  Learning: "Workflows",
  Cybersecurity: "Cybersecurity",
  Coding: "Code",
  Organization: "Agents",
  Infrastructure: "Infrastructure",
  Marketing: "Marketing",
  Voice: "Voice",
  External: "External",
};

/** Layer-rail order — grouped roughly by how often an operator reaches for
 * them, not alphabetically. */
export const CLUSTER_LAYER_ORDER: ClusterId[] = [
  "Infrastructure",
  "Cybersecurity",
  "Knowledge",
  "Memory",
  "Organization",
  "Learning",
  "Projects",
  "Coding",
  "Marketing",
  "Chat",
  "Voice",
  "External",
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
  | "Organization"
  | "MarketingCampaign"
  | "Lead"
  | "Content";

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

  MarketingCampaign: "Marketing",
  Lead: "Marketing",
  Content: "Marketing",

  Repository: "Coding",
  Branch: "Coding",
  Commit: "Coding",

  Organization: "Organization",
  Agent: "Organization",

  Workspace: "Infrastructure",
  Runtime: "Infrastructure",
  Model: "Infrastructure",
  Provider: "Infrastructure",

  // No dedicated Voice or External category yet on the data side — voice
  // sessions are Conversations under the hood, and partner/vendor objects
  // aren't modelled yet — but the clusters exist so the graph already has a
  // region for them the moment those node types ship.
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
  Marketing: "/workspaces/marketing",
  Voice: "/chat",
  External: "/marketplace",
};

export function routeForCluster(cluster: ClusterId): string {
  return CLUSTER_ROUTE[cluster] ?? "/dashboard";
}
