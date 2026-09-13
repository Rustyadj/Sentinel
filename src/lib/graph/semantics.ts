import type { KnowledgeObjectType } from "@/lib/knowledge/types";

/**
 * The graph's visual language, defined once.
 *
 * Every colour resolves to a CSS custom property declared in globals.css, so
 * the graph, entity chips and status dots stay one system and a theme change
 * never means editing components.
 */
export type SemanticCluster =
  | "agent" | "project" | "workspace" | "knowledge"
  | "memory" | "tool" | "source" | "conversation" | "external";

const CLUSTER_BY_TYPE: Partial<Record<KnowledgeObjectType, SemanticCluster>> = {
  Agent: "agent",
  Person: "agent",
  Organization: "external",
  Project: "project",
  Workspace: "workspace",
  Repository: "workspace",
  Module: "tool",
  Workflow: "tool",
  Task: "tool",
  Memory: "memory",
  Note: "knowledge",
  Decision: "knowledge",
  File: "source",
  Artifact: "source",
  Conversation: "conversation",
  Message: "conversation",
};

export function clusterOf(type: KnowledgeObjectType): SemanticCluster {
  return CLUSTER_BY_TYPE[type] ?? "knowledge";
}

export const CLUSTER_LABEL: Record<SemanticCluster, string> = {
  agent: "Agents",
  project: "Projects",
  workspace: "Workspaces",
  knowledge: "Knowledge",
  memory: "Memory",
  tool: "Tools",
  source: "Files & sources",
  conversation: "Conversations",
  external: "External",
};

/** Read a cluster colour from the document's tokens, with a safe fallback. */
export function clusterColor(cluster: SemanticCluster, fallback = "#6b6862") {
  if (typeof window === "undefined") return fallback;
  const value = getComputedStyle(document.documentElement).getPropertyValue(`--entity-${cluster}`).trim();
  return value || fallback;
}

/**
 * Node size communicates importance (how connected it is), not type. Sub-linear
 * so one hub cannot dominate the canvas.
 */
export function nodeRadius(degree: number, isFocus: boolean) {
  const base = 3.2 + Math.sqrt(Math.max(degree, 0)) * 2.1;
  return Math.min(isFocus ? base * 1.5 : base, 18);
}

/**
 * Glow communicates recency: something touched in the last hour reads as live,
 * a month-old node reads as settled. Returns 0..1.
 */
export function recencyIntensity(createdAt: Date | string, now = Date.now()) {
  const timestamp = typeof createdAt === "string" ? Date.parse(createdAt) : createdAt.getTime();
  if (!Number.isFinite(timestamp)) return 0;
  const ageHours = Math.max(now - timestamp, 0) / 3_600_000;
  if (ageHours <= 1) return 1;
  if (ageHours >= 24 * 30) return 0;
  return Math.max(0, 1 - Math.log10(ageHours) / Math.log10(24 * 30));
}

/** Link thickness communicates relationship strength. */
export function edgeWidth(weight: number) {
  return Math.min(0.5 + Math.max(weight, 0) * 1.4, 3.5);
}

export const TIME_WINDOWS = [
  { id: "now", label: "Now", hours: 1 },
  { id: "24h", label: "24 hours", hours: 24 },
  { id: "7d", label: "7 days", hours: 24 * 7 },
  { id: "30d", label: "30 days", hours: 24 * 30 },
  { id: "all", label: "All", hours: null },
] as const;

export type TimeWindowId = typeof TIME_WINDOWS[number]["id"];

export function windowCutoff(id: TimeWindowId): Date | null {
  const window = TIME_WINDOWS.find((entry) => entry.id === id);
  if (!window?.hours) return null;
  return new Date(Date.now() - window.hours * 3_600_000);
}
