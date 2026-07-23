import { db } from "@/lib/db";
import { writeAuditLog } from "./audit";

export function listProjects(filter: { workspaceId?: string; userId?: string } = {}) {
  return db.project.findMany({
    where: {
      ...(filter.workspaceId ? { workspaceId: filter.workspaceId } : {}),
      ...(filter.userId ? { userId: filter.userId } : {}),
    },
    include: { workspace: { select: { id: true, name: true, slug: true } }, _count: { select: { documents: true, tasks: true } } },
    orderBy: { updatedAt: "desc" },
  });
}

export async function createProject(
  input: { name: string; description?: string; workspaceId?: string; teamId?: string; status?: string; tags?: string[] },
  userId: string
) {
  const project = await db.project.create({
    data: { ...input, userId, agents: [], tags: input.tags ?? [] },
  });
  await writeAuditLog({
    workspaceId: project.workspaceId,
    projectId: project.id,
    userId,
    action: "project.created",
    entityType: "project",
    entityId: project.id,
    details: { name: project.name },
  });
  return project;
}

export async function updateProject(id: string, data: { name?: string; description?: string | null; status?: string; teamId?: string | null; tags?: string[] }, userId: string) {
  const project = await db.project.update({ where: { id }, data });
  await writeAuditLog({ workspaceId: project.workspaceId, projectId: id, userId, action: "project.updated", entityType: "project", entityId: id, details: data });
  return project;
}

export async function deleteProject(id: string, userId: string) {
  const project = await db.project.findUniqueOrThrow({ where: { id } });
  await writeAuditLog({ workspaceId: project.workspaceId, projectId: id, userId, action: "project.deleted", entityType: "project", entityId: id });
  return db.project.delete({ where: { id } });
}
