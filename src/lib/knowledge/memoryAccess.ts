import { db } from "@/lib/db";
import { getReadableProjectIds } from "./access";
import { requireProjectPermission } from "@/lib/workspaces/authorization";

export async function memoryReadWhere(userId: string) {
  const projectIds = await getReadableProjectIds(userId);
  return {
    OR: [
      { owner: userId, projectId: null },
      ...(projectIds.length ? [{ scope: "project", projectId: { in: projectIds } }] : []),
    ],
  };
}

export async function requireMemoryAccess(id: string, userId: string, write = false) {
  const memory = await db.memory.findUnique({ where: { id }, select: { id: true, owner: true, projectId: true } });
  if (!memory) return null;
  if (!memory.projectId) return memory.owner === userId ? memory : null;
  const access = await requireProjectPermission(memory.projectId, write ? "project.update" : "project.read").catch(() => null);
  return access?.user.id === userId ? memory : null;
}
