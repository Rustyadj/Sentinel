import { db } from "@/lib/db";
import { RuntimeError } from "@/lib/agents/runtime/errors";

/** Strips the glob suffix so "src/lib/orchestration/**" and "src/lib/orchestration/*" both root to "src/lib/orchestration/". */
function patternRoot(pattern: string): string {
  return pattern.replace(/[*].*$/, "");
}

export function patternsOverlap(a: string, b: string): boolean {
  const rootA = patternRoot(a);
  const rootB = patternRoot(b);
  return rootA.startsWith(rootB) || rootB.startsWith(rootA);
}

export interface AcquireLockInput {
  chatRoomId: string;
  taskId?: string;
  agentId: string;
  resourcePattern: string;
  mode?: "read" | "write";
  workingDirectory?: string;
  branch?: string;
  worktreePath?: string;
}

/**
 * Two "read" locks never conflict; anything else conflicts if another
 * agent already holds an active lock over an overlapping resource.
 * Conflicts fail closed with a 409 carrying who holds it, matching the
 * wait/handoff/parallel-worktree/force-override options the UI offers.
 */
export async function acquireExecutionLock(input: AcquireLockInput) {
  return db.$transaction(async (tx) => {
    const active = await tx.executionLock.findMany({
      where: { chatRoomId: input.chatRoomId, releasedAt: null },
    });
    const conflict = active.find((lock) => {
      if (lock.agentId === input.agentId) return false;
      if (lock.mode === "read" && (input.mode ?? "write") === "read") return false;
      return patternsOverlap(lock.resourcePattern, input.resourcePattern);
    });
    if (conflict) {
      throw new RuntimeError(
        `Resource "${input.resourcePattern}" conflicts with a lock held by ${conflict.agentId} on "${conflict.resourcePattern}"`,
        "execution_lock_conflict",
        409,
      );
    }
    return tx.executionLock.create({
      data: {
        chatRoomId: input.chatRoomId,
        taskId: input.taskId,
        agentId: input.agentId,
        resourcePattern: input.resourcePattern,
        mode: input.mode ?? "write",
        workingDirectory: input.workingDirectory,
        branch: input.branch,
        worktreePath: input.worktreePath,
      },
    });
  });
}

export async function releaseExecutionLock(lockId: string) {
  return db.executionLock.update({ where: { id: lockId }, data: { releasedAt: new Date() } });
}

export async function releaseAgentLocks(chatRoomId: string, agentId: string, taskId?: string) {
  return db.executionLock.updateMany({
    where: { chatRoomId, agentId, releasedAt: null, ...(taskId ? { taskId } : {}) },
    data: { releasedAt: new Date() },
  });
}

export async function listActiveLocks(chatRoomId: string) {
  return db.executionLock.findMany({ where: { chatRoomId, releasedAt: null } });
}

/** Finds an active lock some other agent holds that would conflict with `agentId` taking `fileScope`, if any. */
export async function findConflictingLock(chatRoomId: string, agentId: string, fileScope: string[]) {
  if (!fileScope.length) return null;
  const locks = await listActiveLocks(chatRoomId);
  return locks.find((lock) => lock.agentId !== agentId && fileScope.some((pattern) => patternsOverlap(lock.resourcePattern, pattern))) ?? null;
}
