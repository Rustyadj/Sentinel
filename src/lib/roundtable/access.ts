import { db } from "@/lib/db";
import { reachableProjectIds, userCanOnProject } from "@/lib/people/project-access";
import { RoundtableError } from "./engine";

/**
 * A roundtable belongs to whoever started it. One started inside a project is
 * also open to that project's people: readable with project.read, and open to
 * speaking in with project.update.
 */
export async function requireDiscussionAccess(discussionId: string, userId: string, mode: "read" | "write") {
  const discussion = await db.discussion.findUnique({ where: { id: discussionId } });
  if (!discussion) throw new RoundtableError("Roundtable not found.", 404);
  if (!discussion.projectId && discussion.createdById === userId) return discussion;
  if (discussion.projectId) {
    const project = await db.project.findUnique({ where: { id: discussion.projectId }, select: { id: true, userId: true, workspaceId: true } });
    if (project && (await userCanOnProject(userId, project, mode === "read" ? "project.read" : "project.update"))) return discussion;
  }
  throw new RoundtableError("Roundtable not found.", 404);
}

export async function listDiscussions(userId: string) {
  const projectIds = await reachableProjectIds(userId);
  return db.discussion.findMany({
    where: projectIds.length ? { OR: [{ createdById: userId }, { projectId: { in: projectIds } }] } : { createdById: userId },
    orderBy: { createdAt: "desc" },
    take: 60,
    select: {
      id: true, title: true, topic: true, status: true, agentIds: true, rounds: true, createdAt: true, completedAt: true,
      projectId: true, createdById: true,
      project: { select: { name: true } }, createdBy: { select: { name: true } }, _count: { select: { turns: true } },
    },
  });
}
