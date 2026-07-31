import { removeFromGraph, syncToGraph } from "./sync";
import type { GraphEdgeSpec } from "./sync";

export async function syncDecisionToGraph(decision: {
  id: string;
  title: string;
  summary: string;
  status: string;
  rationale: string | null;
  projectId: string | null;
  supersedesDecisionId: string | null;
}): Promise<void> {
  const edges: GraphEdgeSpec[] = [];

  if (decision.projectId) {
    edges.push({
      toSourceType: "project",
      toSourceId: decision.projectId,
      type: "belongs_to",
    });
  }
  if (decision.supersedesDecisionId) {
    edges.push({
      toSourceType: "decision",
      toSourceId: decision.supersedesDecisionId,
      type: "supersedes",
    });
  }

  await syncToGraph({
    sourceType: "decision",
    sourceId: decision.id,
    type: "Decision",
    title: decision.title,
    summary: decision.summary,
    scope: decision.projectId ? "project" : "global",
    projectId: decision.projectId ?? undefined,
    metadata: {
      status: decision.status,
      ...(decision.rationale ? { rationale: decision.rationale } : {}),
    },
    edges,
  });
}

export async function removeDecisionFromGraph(decisionId: string): Promise<void> {
  await removeFromGraph("decision", decisionId);
}
