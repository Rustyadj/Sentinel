import { syncToGraph, removeFromGraph } from "./sync";
import type { GraphEdgeSpec } from "./sync";

/** Syncs a Workflow row to a real KnowledgeObject node. Call after create/update. */
export async function syncWorkflowToGraph(workflow: {
  id: string;
  name: string;
  description: string | null;
  status: string;
  projectId: string | null;
}): Promise<void> {
  const edges: GraphEdgeSpec[] = [];
  if (workflow.projectId) {
    edges.push({ toSourceType: "project", toSourceId: workflow.projectId, type: "belongs_to" });
  }
  await syncToGraph({
    sourceType: "workflow",
    sourceId: workflow.id,
    type: "Workflow",
    title: workflow.name,
    summary: workflow.description ?? undefined,
    scope: workflow.projectId ? "project" : "global",
    projectId: workflow.projectId ?? undefined,
    metadata: { status: workflow.status },
    edges,
  });
}

export async function removeWorkflowFromGraph(workflowId: string): Promise<void> {
  await removeFromGraph("workflow", workflowId);
}
