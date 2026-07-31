import { db } from "@/lib/db";
import { syncToGraph, removeFromGraph } from "@/lib/knowledge/sync";
import type { GraphEdgeSpec } from "@/lib/knowledge/sync";

// Mapped onto the existing KnowledgeObjectType union rather than extending
// it — Brand is conceptually closest to Organization, ContentProject to
// Project (exact fit), ContentItem to Artifact (a generated/created piece
// of content), Asset to File. ContentHook is deliberately not synced as its
// own node — an A/B hook variant is a small text field on a ContentItem,
// not a standalone thing a user navigates to in the graph.

export async function syncBrandToGraph(brand: { id: string; name: string }): Promise<void> {
  await syncToGraph({
    sourceType: "brand",
    sourceId: brand.id,
    type: "Organization",
    title: brand.name,
    scope: "global",
  });
}

export async function removeBrandFromGraph(brandId: string): Promise<void> {
  await removeFromGraph("brand", brandId);
}

export async function syncContentProjectToGraph(project: {
  id: string;
  name: string;
  brandId: string;
}): Promise<void> {
  const edges: GraphEdgeSpec[] = [
    { toSourceType: "brand", toSourceId: project.brandId, type: "belongs_to" },
  ];
  await syncToGraph({
    sourceType: "content_project",
    sourceId: project.id,
    type: "Project",
    title: project.name,
    scope: "global",
    edges,
  });
}

export async function removeContentProjectFromGraph(projectId: string): Promise<void> {
  await removeFromGraph("content_project", projectId);
}

export async function syncContentItemToGraph(item: {
  id: string;
  title: string;
  type: string;
  brandId: string;
  projectId: string | null;
  sourceItemId: string | null;
}): Promise<void> {
  const edges: GraphEdgeSpec[] = [
    { toSourceType: "brand", toSourceId: item.brandId, type: "belongs_to" },
  ];
  if (item.projectId) {
    edges.push({ toSourceType: "content_project", toSourceId: item.projectId, type: "belongs_to" });
  }
  if (item.sourceItemId) {
    edges.push({ toSourceType: "content_item", toSourceId: item.sourceItemId, type: "generated_by" });
  }
  await syncToGraph({
    sourceType: "content_item",
    sourceId: item.id,
    type: "Artifact",
    title: item.title,
    summary: item.type,
    scope: "global",
    metadata: { contentType: item.type },
    edges,
  });
}

export async function removeContentItemFromGraph(itemId: string): Promise<void> {
  await removeFromGraph("content_item", itemId);
}

export async function syncAssetToGraph(asset: {
  id: string;
  name: string;
  category: string;
  brandId: string;
}): Promise<void> {
  const edges: GraphEdgeSpec[] = [
    { toSourceType: "brand", toSourceId: asset.brandId, type: "belongs_to" },
  ];
  await syncToGraph({
    sourceType: "asset",
    sourceId: asset.id,
    type: "File",
    title: asset.name,
    summary: asset.category,
    scope: "global",
    metadata: { category: asset.category },
    edges,
  });
}

export async function removeAssetFromGraph(assetId: string): Promise<void> {
  await removeFromGraph("asset", assetId);
}

// Only wired for Task rows created via Creator Studio's project-task routes
// (contentProjectId-scoped). The legacy workspaces task routes
// (workspaceId/projectId-scoped, see docs/LEGACY_WORKSPACES.md) are frozen
// and not touched — a task created there simply has no graph node yet,
// which is a gap to close later, not a naming collision: sourceId is the
// real Task row's own id either way.
export async function syncTaskToGraph(task: {
  id: string;
  title: string;
  status: string;
  priority: string;
  contentProjectId: string | null;
  agentId: string | null;
}): Promise<void> {
  const edges: GraphEdgeSpec[] = [];
  if (task.contentProjectId) {
    edges.push({ toSourceType: "content_project", toSourceId: task.contentProjectId, type: "belongs_to" });
  }
  if (task.agentId) {
    edges.push({ toSourceType: "agent", toSourceId: task.agentId, type: "assigned_to" });
  }
  await syncToGraph({
    sourceType: "task",
    sourceId: task.id,
    type: "Task",
    title: task.title,
    summary: task.priority,
    scope: "global",
    metadata: { status: task.status, priority: task.priority },
    edges,
  });
}

export async function removeTaskFromGraph(taskId: string): Promise<void> {
  await removeFromGraph("task", taskId);
}

// Mapped to "Note" — the Idea Vault's own spec describes it as a captured-
// knowledge concept (ideas, voice notes, URLs, tweets, articles...) closer
// to a note than any other existing type. sourceType stays "idea" (distinct
// from ObsidianNote's "note") so the two never collide despite sharing a
// KnowledgeObjectType label.
//
// Idea already has a knowledgeObjectId column reserved for exactly this —
// populate it after syncing so the Idea row carries a direct FK to its graph
// node, not just the indirect sourceType/sourceId lookup every other model
// here relies on.
export async function syncIdeaToGraph(idea: {
  id: string;
  title: string;
  content: string | null;
  brandId: string;
}): Promise<void> {
  const edges: GraphEdgeSpec[] = [
    { toSourceType: "brand", toSourceId: idea.brandId, type: "belongs_to" },
  ];
  const node = await syncToGraph({
    sourceType: "idea",
    sourceId: idea.id,
    type: "Note",
    title: idea.title,
    summary: idea.content?.slice(0, 160) ?? undefined,
    scope: "global",
    edges,
  });
  await db.idea.update({ where: { id: idea.id }, data: { knowledgeObjectId: node.id } }).catch(() => {});
}

export async function removeIdeaFromGraph(ideaId: string): Promise<void> {
  await removeFromGraph("idea", ideaId);
}
