import { db } from "@/lib/db";
import { getVpsAgent } from "@/lib/agents/registry";

const TERMINAL_SESSION_STATUSES = new Set(["completed", "failed", "cancelled", "timed_out"]);

function agentLabel(agentId: string | null): string | null {
  if (!agentId) return null;
  return getVpsAgent(agentId)?.name ?? agentId;
}

export async function getTaskDetail(taskId: string) {
  const task = await db.task.findUnique({
    where: { id: taskId },
    include: {
      workspace: { select: { id: true, name: true, color: true } },
      project: { select: { id: true, name: true } },
    },
  });
  if (!task) return null;

  const [timeline, locks, approvals, disagreements, artifacts] = await Promise.all([
    task.chatRoomId
      ? db.collaborationEvent.findMany({
          where: { chatRoomId: task.chatRoomId, payload: { path: ["taskId"], equals: task.id } },
          orderBy: { sequence: "asc" },
        })
      : Promise.resolve([]),
    db.executionLock.findMany({ where: { taskId: task.id }, orderBy: { createdAt: "desc" } }),
    db.approvalRequest.findMany({ where: { taskId: task.id }, orderBy: { createdAt: "desc" } }),
    db.agentDisagreement.findMany({ where: { taskId: task.id }, orderBy: { createdAt: "desc" } }),
    db.artifact.findMany({ where: { taskId: task.id }, orderBy: { createdAt: "desc" } }),
  ]);

  // The task's own execution session isn't a separate foreign key — it's
  // the same (chatRoomId, workingDirectory) pair runAgentTurn already keys
  // sessions on (agent-turn.ts), since each task gets its own worktree path
  // as its working directory. No schema change needed to find it.
  let liveSessionId: string | null = null;
  if (task.chatRoomId && task.worktreePath) {
    const session = await db.agentSession.findFirst({
      where: { chatRoomId: task.chatRoomId, workingDirectory: task.worktreePath },
      orderBy: { lastActivityAt: "desc" },
      select: { id: true, status: true },
    });
    if (session && !TERMINAL_SESSION_STATUSES.has(session.status)) liveSessionId = session.id;
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
