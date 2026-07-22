// Knowledge Engine — append-only event log

import { db } from "@/lib/db";
import type { Prisma } from "@prisma/client";
import type { KnowledgeEventType } from "./types";

function toInputJson(value: Record<string, unknown>): Prisma.InputJsonValue {
  return value as unknown as Prisma.InputJsonValue;
}

export async function emitEvent(params: {
  userId?: string;
  type: KnowledgeEventType;
  payload: Record<string, unknown>;
  roomId?: string;
  workspaceId?: string;
  projectId?: string;
}): Promise<void> {
  try {
    await db.knowledgeEvent.create({
      data: {
        type: params.type,
        payload: toInputJson(params.payload),
        roomId: params.roomId ?? null,
        workspaceId: params.workspaceId ?? null,
        projectId: params.projectId ?? null,
        userId: params.userId ?? null,
      },
    });
  } catch (err) {
    throw new Error(
      `emitEvent failed: ${err instanceof Error ? err.message : String(err)}`
    );
  }
}

export async function getRecentEvents(filter: {
  userId: string;
  roomId?: string;
  projectId?: string;
  limit?: number;
}): Promise<Array<{ id: string; type: string; payload: unknown; createdAt: Date }>> {
  try {
    const records = await db.knowledgeEvent.findMany({
      where: {
        userId: filter.userId,
        ...(filter.roomId ? { roomId: filter.roomId } : {}),
        ...(filter.projectId ? { projectId: filter.projectId } : {}),
      },
      orderBy: { createdAt: "desc" },
      take: filter.limit ?? 50,
    });
    return records.map((r) => ({
      id: r.id,
      type: r.type,
      payload: r.payload,
      createdAt: r.createdAt,
    }));
  } catch (err) {
    throw new Error(
      `getRecentEvents failed: ${err instanceof Error ? err.message : String(err)}`
    );
  }
}
