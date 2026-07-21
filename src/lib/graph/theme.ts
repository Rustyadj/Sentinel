// Sentinel OS knowledge graph — semantic color system.
//
// Restrained palette by meaning, not by type-rainbow:
//   neutral  — ordinary knowledge (notes, files, artifacts, people)
//   blue     — projects, organization, structure
//   purple   — AI, reasoning, memory
//   green    — healthy systems, completed / approved actions
//   amber    — active processing (state-driven, applied at draw time)
//   red      — security alerts and failures only

import type { KnowledgeNode } from "@/lib/knowledge/types";

export const GRAPH_COLORS = {
  neutral: "#8b93a7",
  neutralBright: "#d7dbe4",
  blue: "#3b82f6",
  cyan: "#22d3ee",
  purple: "#8b5cf6",
  green: "#10b981",
  amber: "#f59e0b",
  red: "#ef4444",
  background: "#050810",
  label: "#c9cede",
  edge: "rgba(122, 143, 176, 0.16)",
  edgeHighlight: "rgba(147, 197, 253, 0.65)",
  pulse: "#a78bfa",
} as const;

const BLUE_TYPES = new Set(["Project", "Organization", "Workspace", "Conversation"]);
const PURPLE_TYPES = new Set(["Agent", "Memory", "Message", "Module"]);

export function nodeColor(node: Pick<KnowledgeNode, "type" | "metadata">): string {
  const meta = node.metadata as { status?: string; alert?: boolean; accent?: string } | undefined;

  if (meta?.accent) return meta.accent;

  // Red strictly for security alerts / failures
  if (meta?.alert === true || meta?.status === "error" || meta?.status === "failed") {
    return GRAPH_COLORS.red;
  }
  // Green for completed / approved actions and healthy systems
  if (meta?.status === "completed" || meta?.status === "approved" || meta?.status === "healthy") {
    return GRAPH_COLORS.green;
  }
  if (node.type === "Decision") return GRAPH_COLORS.green;
  if (BLUE_TYPES.has(node.type)) return GRAPH_COLORS.blue;
  if (PURPLE_TYPES.has(node.type)) return GRAPH_COLORS.purple;
  return GRAPH_COLORS.neutral;
}

/** Base radius by structural importance; degree adds on top. */
export function nodeBaseRadius(type: KnowledgeNode["type"]): number {
  switch (type) {
    case "Project":
    case "Organization":
      return 7;
    case "Workspace":
    case "Agent":
      return 5.5;
    case "Conversation":
    case "Decision":
      return 4.5;
    default:
      return 3.2;
  }
}

export function nodeRadius(type: KnowledgeNode["type"], degree: number): number {
  return nodeBaseRadius(type) + Math.min(3.5, Math.log2(degree + 1) * 1.1);
}

export const GRAPH_LEGEND: Array<{ color: string; label: string }> = [
  { color: GRAPH_COLORS.neutral, label: "Knowledge" },
  { color: GRAPH_COLORS.blue, label: "Projects · Org" },
  { color: GRAPH_COLORS.purple, label: "AI · Memory" },
  { color: GRAPH_COLORS.green, label: "Healthy · Done" },
  { color: GRAPH_COLORS.amber, label: "Processing" },
  { color: GRAPH_COLORS.red, label: "Alerts" },
];
