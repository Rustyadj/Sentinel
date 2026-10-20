import { db } from "@/lib/db";
import { resolveWorkerModel } from "@/lib/agents/model-policy";
import { resolveDefaultAgentWorkspace } from "./defaults";
import { startRuntime } from "./service";
import { runCommand } from "./exec";
import { WorkspaceError } from "./errors";
import { shellArg } from "@/lib/agents/runtime/workspace-runner";

/** Explicit operator operation; never runs on application boot or migration. */
export async function provisionCodingComputers(input: { tenantWorkspaceId: string; ownerUserId: string; image: string }) {
  const tenant = await db.workspace.findUnique({ where: { id: input.tenantWorkspaceId } });
  if (!tenant || tenant.ownerId !== input.ownerUserId) throw new WorkspaceError("Use the tenant owner's user ID.", "workspace_forbidden");
  // Validate all identities before mutating either one. Refuse existing data
  // owned by a different tenant/operator rather than reassigning it.
  for (const agentId of ["claude-code", "codex"]) {
    const candidates = await db.agentWorkspace.findMany({ where: { agentId, OR: [{ status: { not: "DELETED" } }, { isDefault: true }] } });
    if (candidates.some(row => row.workspaceId !== tenant.id || row.ownerUserId !== input.ownerUserId)) {
      throw new WorkspaceError(`Existing ${agentId} workspace ownership differs; resolve it explicitly.`, "workspace_forbidden");
    }
    const existingAgent = await db.agent.findUnique({ where: { id: agentId } });
    const existingRuntime = await db.agentRuntime.findUnique({ where: { id: `runtime-${agentId}` } });
    if ((existingAgent?.workspaceId && existingAgent.workspaceId !== tenant.id) ||
        (existingRuntime && (existingRuntime.agentId !== agentId || existingRuntime.kind !== agentId ||
          (existingRuntime.workspaceId && existingRuntime.workspaceId !== tenant.id)))) {
      throw new WorkspaceError(`Resolve the existing ${agentId} tenant/runtime assignment explicitly before provisioning.`, "workspace_forbidden");
    }
  }
  const results = [];
  for (const agentId of ["claude-code", "codex"] as const) {
    const defaults = resolveWorkerModel(agentId);
    await db.agent.upsert({ where: { id: agentId }, update: { workspaceId: tenant.id },
      create: { id: agentId, name: agentId === "codex" ? "Codex" : "Claude Code", role: "engineer", avatar: "", color: "#6366f1", model: defaults.runtimeModelId,
        reasoningEffort: defaults.effort, workspaceId: tenant.id } });
    const actor = { userId: input.ownerUserId, agentId, client: agentId };
    const workspace = await resolveDefaultAgentWorkspace({ agentId, provisioning: {
      ...input, name: `${agentId === "codex" ? "Codex" : "Claude Code"} Personal Computer`,
      homePath: "/workspace", resourceLimits: { commandTimeoutMs: 600_000 },
      policy: { allowedRuntimeClients: [agentId, "sentinel-ui"], crossAgentDelegation: "explicit-only" }, actor,
    } });
    if (workspace.workspaceId !== tenant.id || workspace.ownerUserId !== input.ownerUserId) throw new WorkspaceError(`Existing ${agentId} computer has a different tenant or owner.`, "workspace_forbidden");
    if (workspace.status !== "ACTIVE" || workspace.locked) throw new WorkspaceError(`Unlock/unarchive ${agentId}'s existing computer explicitly.`, "workspace_locked");
    await startRuntime(workspace, actor);
    // An empty repository gives task worktrees a durable base without copying
    // Sentinel's host checkout. Existing projects and Git history are preserved.
    const root = shellArg(`${workspace.homePath}/projects`);
    const initialized = await runCommand({ workspace, actor, command: `mkdir -p ${root} && cd ${root} && if ! test -e .git; then git init -q && git -c user.name=Sentinel -c user.email=sentinel@localhost commit --allow-empty -qm 'Initialize personal projects'; fi` });
    if (initialized.exitCode !== 0) throw new WorkspaceError("Could not initialize the projects directory.", "command_failed");
    await db.agentRuntime.upsert({ where: { id: `runtime-${agentId}` },
      update: { workspaceId: tenant.id }, create: { id: `runtime-${agentId}`, agentId, kind: agentId, transport: "process", workspaceId: tenant.id,
        executable: agentId === "codex" ? "codex" : "claude", workingDirectoryRoot: `${workspace.homePath}/projects`, executionVerified: false } });
    results.push({ agentId, agentWorkspaceId: workspace.id, volumeName: workspace.volumeName, homePath: workspace.homePath, image: workspace.image });
  }
  return results;
}
