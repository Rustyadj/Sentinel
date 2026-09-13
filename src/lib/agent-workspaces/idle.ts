import { db } from "@/lib/db";
import { logger } from "@/lib/logger";
import { parseLimits } from "./policy";
import { pauseRuntime, reconcileRuntime } from "./service";

/**
 * Release compute from workspaces nobody has touched, while leaving their data
 * exactly where it is. Safe to call repeatedly (cron, worker, or on demand).
 */
export async function sweepIdleWorkspaces(now = new Date()) {
  const candidates = await db.agentWorkspace.findMany({
    where: { status: "ACTIVE", runtimes: { some: { destroyedAt: null, state: "RUNNING" } } },
    include: { runtimes: { where: { destroyedAt: null }, orderBy: { createdAt: "desc" }, take: 1 } },
  });

  const paused: string[] = [];
  for (const workspace of candidates) {
    const limits = parseLimits(workspace.resourceLimits);
    const lastActive = workspace.lastActiveAt ?? workspace.runtimes[0]?.startedAt ?? workspace.updatedAt;
    if (now.getTime() - lastActive.getTime() < limits.idleTimeoutMs) continue;

    // Never pause a workspace that still has tracked work running.
    const busy = await db.workspaceProcess.count({ where: { agentWorkspaceId: workspace.id, status: "running" } });
    if (busy > 0) continue;

    try {
      const live = await reconcileRuntime(workspace);
      if (live?.state !== "RUNNING") continue;
      await pauseRuntime(workspace, { client: "system", userId: null, agentId: null }, "idle");
      paused.push(workspace.id);
    } catch (error) {
      logger.warn("agent-workspace idle sweep failed", { workspaceId: workspace.id, error: String(error) });
    }
  }
  return { evaluated: candidates.length, paused };
}
