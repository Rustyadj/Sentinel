import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { resolveAutonomySettings, sanitizeAutonomySettings, type AutonomySettingsValues } from "./settings";

/** Effective settings for one agent in one workspace (agent row -> workspace row -> defaults). */
export async function getAutonomySettings(workspaceId: string | null | undefined, agentId?: string | null): Promise<AutonomySettingsValues> {
  if (!workspaceId) return resolveAutonomySettings({});
  const rows = await db.autonomySettings.findMany({
    where: { workspaceId, agentId: { in: agentId ? ["", agentId] : [""] } },
    select: { agentId: true, settings: true },
  });
  const workspaceRow = rows.find((row) => row.agentId === "")?.settings;
  const agentRow = agentId ? rows.find((row) => row.agentId === agentId)?.settings : undefined;
  return resolveAutonomySettings(workspaceRow, agentRow);
}

/** Merge a partial update into the stored row (workspace default when agentId is empty). Returns the stored overrides. */
export async function updateAutonomySettings(input: { workspaceId: string; agentId?: string | null; patch: unknown; userId: string }): Promise<Partial<AutonomySettingsValues>> {
  const agentId = input.agentId ?? "";
  const existing = await db.autonomySettings.findUnique({ where: { workspaceId_agentId: { workspaceId: input.workspaceId, agentId } } });
  const merged = { ...sanitizeAutonomySettings(existing?.settings), ...sanitizeAutonomySettings(input.patch) };
  await db.autonomySettings.upsert({
    where: { workspaceId_agentId: { workspaceId: input.workspaceId, agentId } },
    create: { workspaceId: input.workspaceId, agentId, settings: merged as Prisma.InputJsonValue, updatedById: input.userId },
    update: { settings: merged as Prisma.InputJsonValue, updatedById: input.userId },
  });
  return merged;
}
