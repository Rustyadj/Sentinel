import { db } from "@/lib/db";
import { requireUser } from "@/lib/current-user";
import {
  WorkspaceAccessError,
  requireProjectPermission,
} from "@/lib/workspaces/authorization";

export async function getReadableProjectIds(userId: string): Promise<string[]> {
  const assignments = await db.roleAssignment.findMany({
    where: {
      OR: [{ userId }, { team: { memberUserIds: { has: userId } } }],
      AND: [{ OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }] }],
      role: { permissions: { some: { OR: [{ key: "project.read" }, { key: "*" }] } } },
    },
    select: { workspaceId: true },
  });
  const workspaceIds = [...new Set(assignments.map((item) => item.workspaceId))];
  const projects = await db.project.findMany({
    where: {
      OR: [
        { userId },
        ...(workspaceIds.length ? [{ workspaceId: { in: workspaceIds } }] : []),
        { workspace: { ownerId: userId } },
      ],
    },
    select: { id: true },
  });
  return projects.map((project) => project.id);
}

export async function requireNotePermission(noteId: string, permissionKey: string) {
  const user = await requireUser().catch(() => {
    throw new WorkspaceAccessError("Unauthorized", 401);
  });
  const note = await db.obsidianNote.findUnique({
    where: { id: noteId },
    select: { id: true, userId: true, projectId: true },
  });
  if (!note) throw new WorkspaceAccessError("Note not found", 404);
  if (note.userId === user.id && !note.projectId) return { user, note };
  if (!note.projectId) throw new WorkspaceAccessError("Note not found", 404);
  const access = await requireProjectPermission(note.projectId, permissionKey);
  return { user: access.user, note };
}

export function noteBoundary(userId: string, projectId?: string | null) {
  return projectId ? { projectId } : { projectId: null, userId };
}
