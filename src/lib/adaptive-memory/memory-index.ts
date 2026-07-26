import { db } from "@/lib/db";
import { estimateTokens } from "./active-memory";

export async function upsertMemoryIndexEntry(input: {
  id?: string; organizationId?: string; workspaceId?: string; projectId?: string;
  userId?: string; agentId?: string; scope: string; topic: string; summary: string;
  detailObjectIds: string[]; sourceIds: string[]; importance?: number;
}) {
  const data = { ...input, tokenEstimate: estimateTokens(input.summary), importance: input.importance ?? 0.5 };
  return input.id
    ? db.memoryIndexEntry.update({ where: { id: input.id }, data })
    : db.memoryIndexEntry.create({ data });
}

export function listMemoryIndex(input: { organizationId?: string; workspaceId?: string; projectId?: string; userId?: string; agentId?: string; maxTokens?: number }) {
  return db.memoryIndexEntry.findMany({ where: {
    validTo: null,
    OR: [
      ...(input.projectId ? [{ scope: "project", projectId: input.projectId }] : []),
      ...(input.workspaceId ? [{ scope: "workspace", workspaceId: input.workspaceId }] : []),
      ...(input.organizationId ? [{ scope: "organization", organizationId: input.organizationId }] : []),
      ...(input.userId ? [{ scope: "user", userId: input.userId }] : []),
      ...(input.agentId ? [{ scope: "agent", agentId: input.agentId }] : []),
    ],
  }, orderBy: [{ importance: "desc" }, { updatedAt: "desc" }], take: Math.max(1, Math.floor((input.maxTokens ?? 400) / 40)) });
}
