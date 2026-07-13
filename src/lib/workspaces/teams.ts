import { db } from "@/lib/db";
import { writeAuditLog } from "./audit";

export function listTeams(workspaceId: string) {
  return db.team.findMany({
    where: { workspaceId },
    include: { _count: { select: { projects: true, tasks: true } } },
    orderBy: { name: "asc" },
  });
}

export async function createTeam(input: { workspaceId: string; name: string; description?: string; memberUserIds?: string[]; memberAgentIds?: string[] }, userId: string) {
  const team = await db.team.create({
    data: { ...input, memberUserIds: input.memberUserIds ?? [], memberAgentIds: input.memberAgentIds ?? [] },
  });
  await writeAuditLog({ workspaceId: input.workspaceId, userId, action: "team.created", entityType: "team", entityId: team.id, details: { name: team.name } });
  return team;
}

export async function updateTeam(id: string, data: { name?: string; description?: string | null; memberUserIds?: string[]; memberAgentIds?: string[] }, userId: string) {
  const team = await db.team.update({ where: { id }, data });
  await writeAuditLog({ workspaceId: team.workspaceId, userId, action: "team.updated", entityType: "team", entityId: id, details: data });
  return team;
}

export async function deleteTeam(id: string, userId: string) {
  const team = await db.team.findUniqueOrThrow({ where: { id } });
  await writeAuditLog({ workspaceId: team.workspaceId, userId, action: "team.deleted", entityType: "team", entityId: id });
  return db.team.delete({ where: { id } });
}
