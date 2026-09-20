// Sentinel — which workspaces may this user read memory from, and write it to.
//
// Memory now has a real `workspaceId` (migration 20260920160000). Before that,
// a "workspace-scoped" memory was isolated by `owner`, which is a different
// guarantee wearing the same name: no other member of the workspace could see
// it, so a shared workspace did not share, and the isolation came from the
// owner column rather than from any workspace boundary. Anyone who obtained a
// workspace id gained nothing, but neither did a legitimate colleague.
//
// This module resolves the boundary from the permission system that already
// governs every other workspace resource (roles, role assignments, team
// membership, ownership) rather than inventing a second one for memory.
//
// Three rules it exists to enforce:
//
//   1. Knowing a workspace or project id confers no access. Every id a caller
//      supplies is checked against what that user may actually read; an
//      unauthorised id narrows the result to nothing rather than widening it.
//   2. Unresolved is not global. A scope = "workspace" memory with a null
//      workspaceId (a legacy row whose workspace could not be derived) is
//      unreachable, not visible to everybody. Scope columns fail closed.
//   3. Membership is read from the same permission keys as everything else,
//      so revoking a role revokes memory access with it.

import { db } from "@/lib/db";
import { userHasWorkspacePermission } from "@/lib/workspaces/authorization";

/** The permission that governs reading a workspace's memory. */
export const MEMORY_READ_PERMISSION = "project.read";
/** The permission that governs writing workspace-scoped memory. */
export const MEMORY_WRITE_PERMISSION = "project.write";

export interface MemoryScopeAccess {
  /** Workspaces whose workspace-scoped memory this user may read. */
  workspaceIds: string[];
  /** True when the caller named a workspace they are not authorised for. */
  deniedRequestedWorkspace: boolean;
}

/**
 * Every workspace this user may read memory from.
 *
 * Ownership is checked directly and role assignments through the permission
 * catalogue, matching userHasWorkspacePermission — expired assignments do not
 * count, and a wildcard permission does.
 */
export async function readableWorkspaceIds(userId: string): Promise<string[]> {
  const [owned, assignments] = await Promise.all([
    db.workspace.findMany({ where: { ownerId: userId }, select: { id: true } }),
    db.roleAssignment.findMany({
      where: {
        OR: [{ userId }, { team: { memberUserIds: { has: userId } } }],
        AND: [{ OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }] }],
        role: { permissions: { some: { OR: [{ key: MEMORY_READ_PERMISSION }, { key: "*" }] } } },
      },
      select: { workspaceId: true },
    }),
  ]);
  return [...new Set([...owned.map((row) => row.id), ...assignments.map((row) => row.workspaceId)])];
}

/**
 * Resolve the workspace boundary for one retrieval.
 *
 * When the caller names a workspace, the result is that workspace if they are
 * authorised for it and *nothing* if they are not — never a silent fallback to
 * "everything you can read", which would turn a rejected request into a wider
 * one. When they name none, it is everything they may read.
 */
export async function resolveMemoryScopeAccess(
  userId: string,
  requestedWorkspaceId?: string | null,
): Promise<MemoryScopeAccess> {
  const readable = await readableWorkspaceIds(userId);
  if (!requestedWorkspaceId) return { workspaceIds: readable, deniedRequestedWorkspace: false };
  if (readable.includes(requestedWorkspaceId)) {
    return { workspaceIds: [requestedWorkspaceId], deniedRequestedWorkspace: false };
  }
  return { workspaceIds: [], deniedRequestedWorkspace: true };
}

export class MemoryScopeError extends Error {
  constructor(message: string, public readonly code: string) {
    super(message);
  }
}

/**
 * Validate a workspace-scoped write before it happens.
 *
 * A workspace-scoped memory without a workspace is the legacy shape this work
 * exists to remove, so writing a new one is rejected outright rather than
 * stored as another unresolved row. A project-scoped memory must belong to a
 * project that really is in the workspace claimed for it — otherwise the two
 * columns disagree and every later query has to pick one to believe.
 */
export async function assertWritableMemoryScope(input: {
  userId: string;
  scope: string;
  workspaceId?: string | null;
  projectId?: string | null;
}): Promise<void> {
  const { userId, scope, workspaceId, projectId } = input;

  if (scope === "workspace" && !workspaceId) {
    throw new MemoryScopeError(
      "A workspace-scoped memory must name its workspace.",
      "workspace_required",
    );
  }

  if (projectId && workspaceId) {
    const project = await db.project.findUnique({ where: { id: projectId }, select: { workspaceId: true } });
    if (!project) throw new MemoryScopeError("Project not found.", "project_not_found");
    if (project.workspaceId !== workspaceId) {
      throw new MemoryScopeError(
        "That project does not belong to that workspace.",
        "project_workspace_mismatch",
      );
    }
  }

  if (!workspaceId) return;
  if (!(await userHasWorkspacePermission(userId, workspaceId, MEMORY_WRITE_PERMISSION))) {
    throw new MemoryScopeError("Not authorised to write memory in that workspace.", "forbidden");
  }
}

/**
 * Workspace-scoped memories whose workspace could not be derived by the
 * migration's backfill.
 *
 * These are unreachable by design rather than lost: the migration refused to
 * guess which workspace they belong to, because guessing wrong places one
 * tenant's memory inside another's. Reported so the remainder can be resolved
 * deliberately, by someone who knows.
 */
export async function unresolvedWorkspaceMemories(owner?: string) {
  return db.memory.findMany({
    where: { scope: "workspace", workspaceId: null, ...(owner ? { owner } : {}) },
    select: { id: true, owner: true, content: true, createdAt: true, projectId: true },
    orderBy: { createdAt: "asc" },
  });
}
