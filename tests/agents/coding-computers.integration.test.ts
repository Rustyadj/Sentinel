// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { db } from "@/lib/db";
import { provisionCodingComputers } from "@/lib/agent-workspaces/coding-computers";
import { resolveDefaultAgentWorkspace } from "@/lib/agent-workspaces/defaults";
import { startRuntime, stopRuntime, destroyRuntime, deleteWorkspaceData } from "@/lib/agent-workspaces/service";
import { startProcess, listProcesses, stopProcess } from "@/lib/agent-workspaces/processes";
import { createSnapshot, restoreSnapshot } from "@/lib/agent-workspaces/snapshots";
import { getRuntimeProvider } from "@/lib/agent-workspaces/providers";
import { authorizeAgentRequest } from "@/lib/agent-workspaces/gateway";
import { personalComputerRunner } from "@/lib/agents/runtime/workspace-runner";
import { installedEffortOptions } from "@/lib/agents/model-policy";
import { delegateSession } from "@/lib/agents/runtime/delegation";
import { ClaudeCodeRuntimeAdapter } from "@/lib/agents/runtime/claude-code";
import { CodexRuntimeAdapter } from "@/lib/agents/runtime/codex";
import { ensureTaskWorktree } from "@/lib/orchestration/worktree-manager";
import type { RuntimeInstance } from "@/lib/agents/runtime/types";

const enabled = process.env.SENTINEL_TEST_CODING_DOCKER === "1";
const actor = { client: "sentinel-ui" as const, userId: "test-seed-owner" };
const spec = { tenantWorkspaceId: "test-seed-default", ownerUserId: actor.userId, image: "sentinel/coding-computers:test" };
const instance = (kind: "claude-code" | "codex"): RuntimeInstance => ({ id: `runtime-${kind}`, kind, agentId: kind, transport: "process", executable: "/host/must-never-run", workingDirectoryRoot: "/host/must-never-use" });

describe.skipIf(!enabled)("coding personal computers with real Docker, DB, gateway and adapters", () => {
  beforeAll(async () => {
    vi.stubEnv("SENTINEL_CLAUDE_CODE_API_KEY", "fixture-claude-secret-123");
    vi.stubEnv("SENTINEL_CODEX_API_KEY", "fixture-codex-secret-456");
    await provisionCodingComputers(spec);
  }, 180_000);
  afterAll(async () => {
    for (const agentId of ["claude-code", "codex"]) {
      const workspace = await db.agentWorkspace.findFirst({ where: { agentId, isDefault: true } });
      if (workspace) {
        await db.agentWorkspace.update({ where: { id: workspace.id }, data: { isDefault: false } });
        await deleteWorkspaceData({ ...workspace, isDefault: false }, actor);
      }
    }
    vi.unstubAllEnvs();
  }, 120_000);

  it("provisions repeatedly without duplicating computers or overwriting project files", async () => {
    const first = await resolveDefaultAgentWorkspace({ agentId: "claude-code" });
    const second = await resolveDefaultAgentWorkspace({ agentId: "codex" });
    expect(first.id).not.toBe(second.id);
    expect(first.volumeName).not.toBe(second.volumeName);
    const provider = getRuntimeProvider("docker");
    await provider.writeFile(first.id, "/workspace/projects/preserved.txt", "keep", "utf8");
    const again = await provisionCodingComputers(spec);
    expect(again.map(row => row.agentWorkspaceId)).toEqual([first.id, second.id]);
    expect((await provider.readFile(first.id, "/workspace/projects/preserved.txt", 100)).content).toBe("keep");
  }, 120_000);

  it.each(["claude-code", "codex"] as const)("%s executes sessions and task worktrees in its own computer, with only its own key", async kind => {
    const runtime = instance(kind);
    const adapter = kind === "codex" ? new CodexRuntimeAdapter(async () => runtime) : new ClaudeCodeRuntimeAdapter(async () => runtime);
    const worktree = await ensureTaskWorktree({ runtime, taskId: "isolated-task", agentId: kind, userId: actor.userId });
    const session = await adapter.startSession({ runtimeId: runtime.id, userId: actor.userId, workingDirectory: worktree.path });
    const workspace = await resolveDefaultAgentWorkspace({ agentId: kind });
    expect(session.metadata?.agentWorkspaceId).toBe(workspace.id);
    const events = [];
    for await (const event of adapter.send({ sessionId: session.id, userId: actor.userId, prompt: "run fixture" })) events.push(event);
    expect((await adapter.getSession(session.id))?.status).toBe("completed");
    expect(events.some(event => event.type === "assistant_delta")).toBe(true);
    expect(JSON.stringify(events)).not.toContain("fixture-claude-secret-123");
    expect(JSON.stringify(events)).not.toContain("fixture-codex-secret-456");
    const provider = getRuntimeProvider("docker");
    expect((await provider.readFile(workspace.id, "/workspace/identity-marker", 100)).content).toBe(kind === "codex" ? "codex" : "claude");
    const commands = await db.workspaceCommand.findMany({ where: { agentWorkspaceId: workspace.id } });
    expect(JSON.stringify(commands)).not.toContain("fixture-claude-secret-123");
    expect(JSON.stringify(commands)).not.toContain("fixture-codex-secret-456");
    expect(commands.some(row => row.cwd === worktree.path)).toBe(true);
    await db.agentSession.update({ where: { id: session.id }, data: { metadata: { ...session.metadata, agentWorkspaceId: "another-computer" } } });
    await expect(async () => { for await (const event of adapter.send({ sessionId: session.id, userId: actor.userId, prompt: "reject wrong computer" })) void event; }).rejects.toMatchObject({ code: "workspace_mismatch" });
  }, 120_000);

  it("reads installed model capability evidence from each computer instead of host config", async () => {
    expect(await installedEffortOptions(instance("claude-code"), "claude-opus-5")).toEqual(["low", "medium", "high"]);
    const workspace = await resolveDefaultAgentWorkspace({ agentId: "codex" });
    const { runner } = await personalComputerRunner(instance("codex"), actor.userId);
    await runner.run("mkdir", ["-p", "/workspace/.codex"]);
    await getRuntimeProvider("docker").writeFile(workspace.id, "/workspace/.codex/models_cache.json", JSON.stringify({ models: [{ slug: "fixture-model", supported_reasoning_levels: [{ effort: "medium" }] }] }), "utf8");
    expect(await installedEffortOptions(instance("codex"), "fixture-model")).toEqual(["medium"]);
  }, 30_000);

  it("delegates into a target-owned computer while preserving lineage and audit", async () => {
    const sourceRuntime = instance("claude-code"), targetRuntime = instance("codex");
    const sourceAdapter = new ClaudeCodeRuntimeAdapter(async () => sourceRuntime);
    const source = await sourceAdapter.startSession({ runtimeId: sourceRuntime.id, userId: actor.userId, workspaceId: spec.tenantWorkspaceId });
    const target = await delegateSession({ sourceSessionId: source.id, targetAgentId: "codex", actorUserId: actor.userId, reason: "Explicit review handoff" });
    const targetWorkspace = await resolveDefaultAgentWorkspace({ agentId: "codex" });
    expect(target.parentSessionId).toBe(source.id);
    expect(target.metadata.agentWorkspaceId).toBe(targetWorkspace.id);
    const adapter = new CodexRuntimeAdapter(async () => targetRuntime);
    for await (const event of adapter.send({ sessionId: target.id, userId: actor.userId, prompt: "review fixture" })) void event;
    expect((await adapter.getSession(target.id))?.status).toBe("completed");
    expect(await db.auditLog.findFirst({ where: { entityId: target.id, action: "agent_runtime.session_delegated" } })).toBeTruthy();
  }, 120_000);

  it("retains home and project data through stop/start and compute destruction", async () => {
    const workspace = await resolveDefaultAgentWorkspace({ agentId: "claude-code" });
    const provider = getRuntimeProvider("docker");
    await stopRuntime(workspace, actor);
    await startRuntime(workspace, actor);
    expect((await provider.readFile(workspace.id, "/workspace/identity-marker", 100)).content).toBe("claude");
    await destroyRuntime(workspace, actor);
    await startRuntime(workspace, actor);
    expect((await provider.readFile(workspace.id, "/workspace/projects/preserved.txt", 100)).content).toBe("keep");
  }, 120_000);

  it("rejects cross-agent access, locked workspaces, host paths, and stopped computers", async () => {
    const workspace = await resolveDefaultAgentWorkspace({ agentId: "claude-code" });
    await expect(authorizeAgentRequest({ agentWorkspaceId: workspace.id, actingAgentId: "codex", client: "claude-code", requiredLevel: "write" })).rejects.toMatchObject({ code: "workspace_forbidden" });
    await db.agentWorkspace.update({ where: { id: workspace.id }, data: { locked: true } });
    await expect(personalComputerRunner(instance("claude-code"), actor.userId)).rejects.toMatchObject({ code: "workspace_locked" });
    await db.agentWorkspace.update({ where: { id: workspace.id }, data: { locked: false } });
    const { runner } = await personalComputerRunner(instance("claude-code"), actor.userId);
    await expect(runner.realpath("/opt/sentinel-os")).rejects.toMatchObject({ code: "path_escape" });
    await stopRuntime(workspace, actor);
    await expect(personalComputerRunner(instance("claude-code"), actor.userId)).rejects.toMatchObject({ code: "runtime_not_running" });
    await startRuntime(workspace, actor);
  }, 120_000);

  it("uses existing snapshots for recovery and reports missing credentials/computers", async () => {
    const runtime = instance("codex");
    const workspace = await resolveDefaultAgentWorkspace({ agentId: "codex" });
    const provider = getRuntimeProvider("docker");
    const snapshot = await createSnapshot({ workspace, actor, name: "coding-recovery", reason: "Integration recovery check" });
    await provider.writeFile(workspace.id, "/workspace/identity-marker", "changed", "utf8");
    await restoreSnapshot({ workspace, actor, snapshotId: snapshot.id, confirm: true });
    await startRuntime(workspace, actor);
    expect((await provider.readFile(workspace.id, "/workspace/identity-marker", 100)).content).toBe("codex");
    const adapter = new CodexRuntimeAdapter(async () => runtime);
    expect(await adapter.health(runtime)).toMatchObject({ ready: true, authenticated: null });
    vi.stubEnv("SENTINEL_CODEX_API_KEY", "");
    expect(await adapter.health(runtime)).toMatchObject({ ready: false, failureCode: "credential_missing" });
    vi.stubEnv("SENTINEL_CODEX_API_KEY", "fixture-codex-secret-456");
    const peer = await resolveDefaultAgentWorkspace({ agentId: "claude-code" });
    await db.agentWorkspace.update({ where: { id: workspace.id }, data: { volumeName: peer.volumeName } });
    try {
      await expect(provider.executeCommand({ workspaceId: workspace.id, command: "echo wrong binding" })).rejects.toMatchObject({ code: "workspace_forbidden" });
    } finally { await db.agentWorkspace.update({ where: { id: workspace.id }, data: { volumeName: workspace.volumeName } }); }
    await expect(provider.startWorkspace({ workspaceId: workspace.id, agentId: "codex", volumeName: `missing-${workspace.id}`, image: workspace.image, homePath: workspace.homePath,
      limits: { cpus: 1, memoryMb: 1024, diskGb: 1, pidsLimit: 64, commandTimeoutMs: 1000, idleTimeoutMs: 60000, network: "none" } })).rejects.toMatchObject({ code: "volume_missing" });
  }, 120_000);

  it("retains the existing detached process controls", async () => {
    const workspace = await resolveDefaultAgentWorkspace({ agentId: "codex" });
    const process = await startProcess({ workspace, actor, label: "fixture service", command: "sleep 60" });
    expect(process.pid).toBeTruthy();
    const observed = await listProcesses(workspace);
    expect(observed.live.some(row => row.pid === process.pid)).toBe(true);
    await stopProcess(workspace, process.id, actor);
  }, 30_000);

  it("cancels the in-container process group and bounds command timeouts", async () => {
    const { runner, workspace } = await personalComputerRunner(instance("codex"), actor.userId);
    const child = runner.spawn("bash", ["-c", "trap '' TERM; sleep 40; echo escaped > /workspace/escaped"], {});
    const closed = new Promise<number>( (resolve, reject) => { child.once("close", code => resolve(code ?? -1)); child.once("error", reject); });
    await new Promise(resolve => setTimeout(resolve, 1000));
    child.kill("SIGTERM");
    expect(await closed).not.toBe(0);
    const provider = getRuntimeProvider("docker");
    const result = await provider.executeCommand({ workspaceId: workspace.id, command: "sleep 40", timeoutMs: 1000 });
    expect(result.timedOut).toBe(true);
  }, 30_000);
});
