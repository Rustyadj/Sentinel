import { db } from "@/lib/db";
import { getVpsAgent } from "@/lib/agents/registry";
import { RUNTIME_PERMISSIONS, requireSessionAccess } from "@/lib/agents/runtime/authorization";
import { userHasWorkspacePermission } from "@/lib/workspaces/authorization";

const TERMINAL_SESSION_STATUSES = new Set(["completed", "failed", "cancelled", "timed_out"]);

function agentLabel(agentId: string | null): string | null {
  if (!agentId) return null;
  return getVpsAgent(agentId)?.name ?? agentId;
}

/**
 * May this user see this task? Same scopes the task API enforces: the task's
 * workspace (task.read), else its project (owner, or task.read in the project's
 * workspace), else — for a task that only lives in a chat room — that room's
 * owner. A task with no scope at all is visible to nobody.
 */
export async function canReadTask(userId: string, task: { workspaceId: string | null; projectId: string | null; chatRoomId: string | null }): Promise<boolean> {
  if (task.workspaceId) return userHasWorkspacePermission(userId, task.workspaceId, "task.read");
  if (task.projectId) {
    const project = await db.project.findUnique({ where: { id: task.projectId }, select: { userId: true, workspaceId: true } });
    if (!project) return false;
    if (project.userId === userId) return true;
    return project.workspaceId ? userHasWorkspacePermission(userId, project.workspaceId, "task.read") : false;
  }
  if (task.chatRoomId) {
    const room = await db.chatRoom.findUnique({ where: { id: task.chatRoomId }, select: { userId: true } });
    return room?.userId === userId;
  }
  return false;
}

/**
 * The task as the detail page shows it. Authorization comes first and nothing
 * else is read for a viewer who fails it. Only the fields the page renders are
 * selected, because the result is handed to a client component and so reaches the
 * browser whole: approval payloads, lock tokens and the like never should.
 */
export async function getTaskDetail(
  taskId: string,
  viewerId: string,
  options: { canViewSession?: (sessionId: string) => Promise<boolean> } = {},
) {
  const task = await db.task.findUnique({
    where: { id: taskId },
    select: {
      id: true, title: true, description: true, status: true, priority: true,
      workspaceId: true, projectId: true, chatRoomId: true,
      agentId: true, reviewerAgentId: true, createdByAgentId: true,
      branch: true, baseBranch: true, worktreePath: true,
      workspace: { select: { id: true, name: true, color: true } },
      project: { select: { id: true, name: true } },
    },
  });
  if (!task || !(await canReadTask(viewerId, task))) return null;

  const [timeline, locks, approvals, disagreements, artifacts] = await Promise.all([
    task.chatRoomId
      ? db.collaborationEvent.findMany({
          where: { chatRoomId: task.chatRoomId, payload: { path: ["taskId"], equals: task.id } },
          orderBy: { sequence: "asc" },
          select: { id: true, type: true, occurredAt: true },
        })
      : Promise.resolve([]),
    db.executionLock.findMany({ where: { taskId: task.id }, orderBy: { createdAt: "desc" }, select: { id: true, agentId: true, resourcePattern: true, releasedAt: true } }),
    db.approvalRequest.findMany({ where: { taskId: task.id }, orderBy: { createdAt: "desc" }, select: { id: true, title: true, status: true } }),
    db.agentDisagreement.findMany({ where: { taskId: task.id }, orderBy: { createdAt: "desc" }, select: { id: true, issue: true, resolvedAt: true } }),
    db.artifact.findMany({ where: { taskId: task.id }, orderBy: { createdAt: "desc" }, select: { id: true, title: true, type: true, content: true } }),
  ]);

  // The task's own execution session isn't a separate foreign key — it's
  // the same (chatRoomId, workingDirectory) pair runAgentTurn already keys
  // sessions on (agent-turn.ts), since each task gets its own worktree path
  // as its working directory. No schema change needed to find it. The id is
  // only handed over to a viewer who may also open the session's event stream.
  let liveSessionId: string | null = null;
  if (task.chatRoomId && task.worktreePath) {
    const session = await db.agentSession.findFirst({
      where: { chatRoomId: task.chatRoomId, workingDirectory: task.worktreePath },
      orderBy: { lastActivityAt: "desc" },
      select: { id: true, status: true },
    });
    if (session && !TERMINAL_SESSION_STATUSES.has(session.status)) {
      const canView = options.canViewSession ?? (async (id: string) => requireSessionAccess(id, RUNTIME_PERMISSIONS.view).then(() => true, () => false));
      if (await canView(session.id)) liveSessionId = session.id;
    }
  }

  return {
    task,
    ownerName: agentLabel(task.agentId),
    reviewerName: agentLabel(task.reviewerAgentId),
    creatorName: agentLabel(task.createdByAgentId),
    timeline,
    locks,
    approvals,
    disagreements,
    artifacts,
    liveSessionId,
  };
}

export type TaskDetail = NonNullable<Awaited<ReturnType<typeof getTaskDetail>>>;
