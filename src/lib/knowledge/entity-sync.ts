// Knowledge Engine — canonical entity → graph sync
//
// Task and Workflow rows are canonical, single-owner-at-creation-time
// entities: exactly one KnowledgeObject node should represent a given task
// or workflow, no matter who edits it afterward. createKnowledgeObject()'s
// upsert key deliberately includes userId (src/lib/knowledge/objects.ts) —
// right for user-owned bridge rows like extracted memories, where the same
// source can legitimately produce a distinct node per viewer, but wrong here:
// keying on userId would mint a second graph node the first time a different
// teammate edits the same task. This looks the row up by (sourceType,
// sourceId) alone instead — same idempotent lookup
// getOrCreateKnowledgeObjectForSource (neural-engine/knowledge-bridge.ts)
// uses — but also updates the existing row on every call, so status/title
// changes stay reflected instead of only being captured once at creation.

import { db } from "@/lib/db";
import type { Prisma } from "@prisma/client";
import type { KnowledgeObjectType, KnowledgeScope } from "./types";

function toJson(value: Record<string, unknown>): Prisma.InputJsonValue {
  return value as unknown as Prisma.InputJsonValue;
}

interface EntitySyncParams {
  type: KnowledgeObjectType;
  title: string;
  summary?: string | null;
  sourceType: string;
  sourceId: string;
  scope: KnowledgeScope;
  workspaceId?: string | null;
  projectId?: string | null;
  metadata?: Record<string, unknown>;
  /** Only applied when creating a new node — an existing node's owner never changes on update. */
  ownerUserId?: string | null;
}

export async function syncEntityToGraph(params: EntitySyncParams): Promise<string> {
  const existing = await db.knowledgeObject.findFirst({
    where: { sourceType: params.sourceType, sourceId: params.sourceId },
    select: { id: true },
  });

  if (existing) {
    const updated = await db.knowledgeObject.update({
      where: { id: existing.id },
      data: {
        title: params.title,
        summary: params.summary ?? null,
        scope: params.scope,
        workspaceId: params.workspaceId ?? null,
        projectId: params.projectId ?? null,
        metadata: toJson(params.metadata ?? {}),
      },
    });
    return updated.id;
  }

  const created = await db.knowledgeObject.create({
    data: {
      type: params.type,
      title: params.title,
      summary: params.summary ?? null,
      sourceType: params.sourceType,
      sourceId: params.sourceId,
      scope: params.scope,
      workspaceId: params.workspaceId ?? null,
      projectId: params.projectId ?? null,
      userId: params.ownerUserId ?? null,
      metadata: toJson(params.metadata ?? {}),
    },
  });
  return created.id;
}

/** Delete-cascades to any edges this entity's node participated in (KnowledgeEdge is onDelete: Cascade). */
export async function removeEntityFromGraph(sourceType: string, sourceId: string): Promise<void> {
  await db.knowledgeObject.deleteMany({ where: { sourceType, sourceId } });
}

export interface TaskGraphInput {
  id: string;
  title: string;
  description: string | null;
  status: string;
  priority: string;
  workspaceId: string | null;
  projectId: string | null;
  tags: string[];
}

export async function syncTaskToGraph(task: TaskGraphInput, actingUserId: string): Promise<string> {
  return syncEntityToGraph({
    type: "Task" as KnowledgeObjectType,
    title: task.title,
    summary: task.description,
    sourceType: "task",
    sourceId: task.id,
    scope: task.projectId ? "project" : task.workspaceId ? "workspace" : "global",
    workspaceId: task.workspaceId,
    projectId: task.projectId,
    ownerUserId: actingUserId,
    metadata: { status: task.status, priority: task.priority, tags: task.tags },
  });
}

export interface WorkflowGraphInput {
  id: string;
  name: string;
  description: string | null;
  status: string;
  projectId: string | null;
  userId: string | null;
}

export async function syncWorkflowToGraph(workflow: WorkflowGraphInput): Promise<string> {
  return syncEntityToGraph({
    type: "Workflow" as KnowledgeObjectType,
    title: workflow.name,
    summary: workflow.description,
    sourceType: "workflow",
    sourceId: workflow.id,
    scope: workflow.projectId ? "project" : "global",
    projectId: workflow.projectId,
    ownerUserId: workflow.userId,
    metadata: { status: workflow.status },
  });
}
