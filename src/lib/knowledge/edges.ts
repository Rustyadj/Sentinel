// Knowledge Engine — KnowledgeEdge CRUD

import { db } from "@/lib/db";
import type { Prisma } from "@prisma/client";
import type { KnowledgeEdgeType, KnowledgeEdge } from "./types";

function toInputJson(value: Record<string, unknown>): Prisma.InputJsonValue {
  return value as unknown as Prisma.InputJsonValue;
}

function toKnowledgeEdge(record: {
  id: string;
  fromObjectId: string;
  toObjectId: string;
  type: string;
  weight: number;
  metadata: unknown;
}): KnowledgeEdge {
  return {
    id: record.id,
    fromObjectId: record.fromObjectId,
    toObjectId: record.toObjectId,
    type: record.type as KnowledgeEdgeType,
    weight: record.weight,
    metadata: (record.metadata as Record<string, unknown>) ?? {},
  };
}

export async function createEdge(params: {
  fromObjectId: string;
  toObjectId: string;
  type: KnowledgeEdgeType;
  weight?: number;
  metadata?: Record<string, unknown>;
}): Promise<KnowledgeEdge> {
  try {
    const record = await db.knowledgeEdge.create({
      data: {
        fromObjectId: params.fromObjectId,
        toObjectId: params.toObjectId,
        type: params.type,
        weight: params.weight ?? 1.0,
        metadata: toInputJson(params.metadata ?? {}),
      },
    });
    return toKnowledgeEdge(record);
  } catch (err) {
    throw new Error(
      `createEdge failed: ${err instanceof Error ? err.message : String(err)}`
    );
  }
}

// Upsert — no duplicate edges of same type between same nodes
export async function upsertEdge(params: {
  fromObjectId: string;
  toObjectId: string;
  type: KnowledgeEdgeType;
  weight?: number;
  metadata?: Record<string, unknown>;
}): Promise<KnowledgeEdge> {
  try {
    const record = await db.knowledgeEdge.upsert({
      where: {
        fromObjectId_toObjectId_type: {
          fromObjectId: params.fromObjectId,
          toObjectId: params.toObjectId,
          type: params.type,
        },
      },
      create: {
        fromObjectId: params.fromObjectId,
        toObjectId: params.toObjectId,
        type: params.type,
        weight: params.weight ?? 1.0,
        metadata: toInputJson(params.metadata ?? {}),
      },
      update: {
        weight: params.weight ?? 1.0,
        ...(params.metadata ? { metadata: toInputJson(params.metadata) } : {}),
      },
    });
    return toKnowledgeEdge(record);
  } catch (err) {
    throw new Error(
      `upsertEdge failed: ${err instanceof Error ? err.message : String(err)}`
    );
  }
}

export async function listEdges(filter: {
  fromObjectId?: string;
  toObjectId?: string;
  type?: KnowledgeEdgeType;
}): Promise<KnowledgeEdge[]> {
  try {
    const records = await db.knowledgeEdge.findMany({
      where: {
        ...(filter.fromObjectId ? { fromObjectId: filter.fromObjectId } : {}),
        ...(filter.toObjectId ? { toObjectId: filter.toObjectId } : {}),
        ...(filter.type ? { type: filter.type } : {}),
      },
      orderBy: { createdAt: "desc" },
    });
    return records.map(toKnowledgeEdge);
  } catch (err) {
    throw new Error(
      `listEdges failed: ${err instanceof Error ? err.message : String(err)}`
    );
  }
}

export async function deleteEdge(id: string): Promise<void> {
  try {
    await db.knowledgeEdge.delete({ where: { id } });
  } catch (err) {
    throw new Error(
      `deleteEdge failed: ${err instanceof Error ? err.message : String(err)}`
    );
  }
}
