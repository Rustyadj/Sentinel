// Knowledge Engine — KnowledgeObject CRUD + bridge functions

import { db } from "@/lib/db";
import type { Prisma } from "@prisma/client";
import type {
  KnowledgeObjectType,
  KnowledgeScope,
  KnowledgeNode,
} from "./types";

function toInputJson(value: Record<string, unknown>): Prisma.InputJsonValue {
  return value as unknown as Prisma.InputJsonValue;
}

export function toKnowledgeNode(record: {
  id: string;
  type: string;
  title: string;
  summary: string | null;
  scope: string;
  metadata: unknown;
  createdAt: Date;
  workspaceId?: string | null;
}): KnowledgeNode {
  return {
    id: record.id,
    type: record.type as KnowledgeObjectType,
    title: record.title,
    summary: record.summary ?? undefined,
    scope: record.scope as KnowledgeScope,
    metadata: (record.metadata as Record<string, unknown>) ?? {},
    createdAt: record.createdAt,
    workspaceId: record.workspaceId ?? undefined,
  };
}

export async function createKnowledgeObject(params: {
  userId: string;
  type: KnowledgeObjectType;
  title: string;
  summary?: string;
  sourceType: string;
  sourceId: string;
  scope?: KnowledgeScope;
  projectId?: string;
  workspaceId?: string;
  organizationId?: string;
  metadata?: Record<string, unknown>;
}): Promise<KnowledgeNode> {
  try {
    const record = await db.knowledgeObject.upsert({
      where: {
        sourceType_sourceId_userId: {
          sourceType: params.sourceType,
          sourceId: params.sourceId,
          userId: params.userId,
        },
      },
      update: {
        type: params.type,
        title: params.title,
        summary: params.summary ?? null,
        scope: params.scope ?? "project",
        projectId: params.projectId ?? null,
        workspaceId: params.workspaceId ?? null,
        organizationId: params.organizationId ?? null,
        metadata: toInputJson(params.metadata ?? {}),
      },
      create: {
        userId: params.userId,
        type: params.type,
        title: params.title,
        summary: params.summary ?? null,
        sourceType: params.sourceType,
        sourceId: params.sourceId,
        scope: params.scope ?? "project",
        projectId: params.projectId ?? null,
        workspaceId: params.workspaceId ?? null,
        organizationId: params.organizationId ?? null,
        metadata: toInputJson(params.metadata ?? {}),
      },
    });
    return toKnowledgeNode(record);
  } catch (err) {
    throw new Error(
      `createKnowledgeObject failed: ${err instanceof Error ? err.message : String(err)}`
    );
  }
}

export async function getKnowledgeObject(
  id: string,
  userId: string
): Promise<KnowledgeNode | null> {
  try {
    const record = await db.knowledgeObject.findFirst({ where: { id, userId } });
    if (!record) return null;
    return toKnowledgeNode(record);
  } catch (err) {
    throw new Error(
      `getKnowledgeObject failed: ${err instanceof Error ? err.message : String(err)}`
    );
  }
}

export async function listKnowledgeObjects(filter: {
  userId: string;
  scope?: KnowledgeScope;
  type?: KnowledgeObjectType;
  projectId?: string;
  workspaceId?: string;
  organizationId?: string;
}): Promise<KnowledgeNode[]> {
  try {
    const records = await db.knowledgeObject.findMany({
      where: {
        userId: filter.userId,
        ...(filter.scope ? { scope: filter.scope } : {}),
        ...(filter.type ? { type: filter.type } : {}),
        ...(filter.projectId !== undefined
          ? { projectId: filter.projectId }
          : {}),
        ...(filter.workspaceId !== undefined
          ? { workspaceId: filter.workspaceId }
          : {}),
        ...(filter.organizationId !== undefined
          ? { organizationId: filter.organizationId }
          : {}),
      },
      orderBy: { createdAt: "desc" },
    });
    return records.map(toKnowledgeNode);
  } catch (err) {
    throw new Error(
      `listKnowledgeObjects failed: ${err instanceof Error ? err.message : String(err)}`
    );
  }
}

// Bridge: convert a DB Memory record into a KnowledgeNode (no DB write)
export function bridgeMemory(memory: {
  id: string;
  content: string;
  type: string;
  scope: string;
  owner: string;
  tags: string[];
  createdAt: Date;
}): KnowledgeNode {
  return {
    id: `memory:${memory.id}`,
    type: "Memory",
    title: memory.content.slice(0, 80) + (memory.content.length > 80 ? "…" : ""),
    summary: memory.content,
    scope: memory.scope as KnowledgeScope,
    metadata: {
      owner: memory.owner,
      tags: memory.tags,
      memoryType: memory.type,
      sourceId: memory.id,
      sourceType: "memory",
    },
    createdAt: memory.createdAt,
  };
}

// Bridge: convert a DB Agent record into a KnowledgeNode (no DB write)
export function bridgeAgent(agent: {
  id: string;
  name: string;
  role: string;
  status: string;
  createdAt: Date;
}): KnowledgeNode {
  return {
    id: `agent:${agent.id}`,
    type: "Agent",
    title: agent.name,
    summary: agent.role,
    scope: "global",
    metadata: {
      role: agent.role,
      status: agent.status,
      sourceId: agent.id,
      sourceType: "agent",
    },
    createdAt: agent.createdAt,
  };
}

// Bridge: convert a DB ChatRoom record into a KnowledgeNode (no DB write)
export function bridgeChatRoom(room: {
  id: string;
  name: string;
  projectId?: string | null;
  createdAt: Date;
}): KnowledgeNode {
  return {
    id: `chatroom:${room.id}`,
    type: "Conversation",
    title: room.name,
    scope: room.projectId ? "project" : "global",
    metadata: {
      projectId: room.projectId ?? null,
      sourceId: room.id,
      sourceType: "chat_room",
    },
    createdAt: room.createdAt,
  };
}
