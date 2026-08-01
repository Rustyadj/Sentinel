// Shared node palette for knowledge-graph views.
// Muted, indigo-forward — harmonized rather than rainbow.
import type { KnowledgeObjectType } from "./types";

export const KNOWLEDGE_NODE_COLORS: Record<KnowledgeObjectType | "default", string> = {
  Agent: "#c4b8f3",
  Person: "#dfa4c4",
  Conversation: "#8f9af5",
  Message: "#6672e0",
  Memory: "#5cc9b0",
  Note: "#d3b25e",
  Decision: "#e08072",
  Task: "#6aa6de",
  Project: "#7c8cf0",
  Workspace: "#58b7c9",
  Workflow: "#9aa8e8",
  File: "#8b95a3",
  Repository: "#8b95a3",
  Module: "#a3c284",
  Artifact: "#a3c284",
  Organization: "#b0a2d8",
  // Learning Core (see docs/LEARNING_CORE_PLAN.md)
  CuriosityEvent: "#e0b872",
  KnowledgeGap: "#d99a5b",
  Reflection: "#8fc9e0",
  Preference: "#a8cf8a",
  Goal: "#7fd6c2",
  Hypothesis: "#c98fe0",
  Experiment: "#b285e8",
  Benchmark: "#8aa8e0",
  TrustEvent: "#e0d872",
  Skill: "#72c9a3",
  Lesson: "#e0a872",
  default: "#7f8694",
};

export function knowledgeNodeColor(type: string): string {
  return (
    KNOWLEDGE_NODE_COLORS[type as KnowledgeObjectType] ?? KNOWLEDGE_NODE_COLORS.default
  );
}
