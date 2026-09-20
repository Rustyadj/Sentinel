import { db } from "@/lib/db";
import { defaultCapabilityWeights } from "@/lib/orchestration/capability-defaults";
import { getRuntimeAdapter, listRuntimeViews } from "./runtime/service";
import { asRuntimeInstance } from "./runtime/config";
import { getAccessibleWorkspaceIds } from "./permissions";

/** Read-only composition; registry/runtime/DB ownership remains unchanged. */
export async function listAgentCapabilityDescriptors(userId?: string) {
  const runtimes = await listRuntimeViews();
  const [agents, competencies, permittedWorkspaceIds] = await Promise.all([
    db.agent.findMany({ where: { id: { in: runtimes.map((r) => r.agentId) } }, select: { id: true, name: true, model: true, capabilityWeights: true, toolPermissions: true, workspaceId: true } }),
    db.agentCompetency.findMany({ where: { agentId: { in: runtimes.map((r) => r.agentId) } }, select: { agentId: true, domain: true, score: true, successRate: true, evidenceCount: true } }),
    userId ? getAccessibleWorkspaceIds(userId) : Promise.resolve([]),
  ]);
  const visibleRuntimes = userId
    ? runtimes.filter((runtime) => {
        const workspaceId = agents.find((item) => item.id === runtime.agentId)?.workspaceId;
        return !workspaceId || permittedWorkspaceIds.includes(workspaceId);
      })
    : runtimes;
  return Promise.all(visibleRuntimes.map(async (runtime) => {
    const agent = agents.find((item) => item.id === runtime.agentId);
    const health = await getRuntimeAdapter(runtime.kind).health(asRuntimeInstance(runtime)).catch(() => null);
    return {
      id: runtime.agentId, name: agent?.name ?? runtime.agentId, kind: runtime.kind,
      model: agent?.model ?? runtime.model,
      capabilities: agent?.capabilityWeights ?? defaultCapabilityWeights(runtime.agentId),
      tools: agent?.toolPermissions ?? [], repositoryAccess: Boolean(runtime.workingDirectoryRoot), concurrency: runtime.capabilities,
      reachable: health?.reachable ?? false, authenticated: health?.authenticated ?? false,
      executionVerified: runtime.executionVerified, executable: runtime.enabled && runtime.executionVerified && health?.ready === true,
      historicalPerformance: competencies.filter((item) => item.agentId === runtime.agentId),
    };
  }));
}
