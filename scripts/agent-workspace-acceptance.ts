/**
 * End-to-end acceptance for the Agent Workspaces subsystem.
 *
 * Runs the real workflow against the real container runtime and database:
 * create -> start -> clone repo -> modify -> stop -> start -> verify
 * persistence -> snapshot -> mutate -> restore -> verify -> cross-agent
 * isolation -> cross-client delegation policy -> teardown.
 *
 *   DATABASE_URL=... npx tsx scripts/agent-workspace-acceptance.ts
 */
import { db } from "../src/lib/db";
import {
  createAgentWorkspace, startRuntime, stopRuntime, reconcileRuntime,
  deleteWorkspaceData, currentRuntime,
} from "../src/lib/agent-workspaces/service";
import { runCommand } from "../src/lib/agent-workspaces/exec";
import { listFiles, writeFile, readFile } from "../src/lib/agent-workspaces/files";
import { createSnapshot, restoreSnapshot, listSnapshots } from "../src/lib/agent-workspaces/snapshots";
import { createArtifact, listArtifacts } from "../src/lib/agent-workspaces/artifacts";
import { startProcess, listProcesses, stopProcess } from "../src/lib/agent-workspaces/processes";
import { assertAgentMayAccess } from "../src/lib/agent-workspaces/authorization";
import { assertClientHandoffAllowed, authorizeAgentRequest } from "../src/lib/agent-workspaces/gateway";
import { grantPermission } from "../src/lib/agent-workspaces/handoff";
import { listWorkspaceEvents } from "../src/lib/agent-workspaces/events";
import { WorkspaceError } from "../src/lib/agent-workspaces/errors";

const results: { step: string; ok: boolean; detail?: string }[] = [];
function check(step: string, ok: boolean, detail?: string) {
  results.push({ step, ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"}  ${step}${detail ? ` — ${detail}` : ""}`);
  if (!ok) process.exitCode = 1;
}

async function fixtures() {
  const user = await db.user.upsert({
    where: { email: "workspace-acceptance@sentinel.local" },
    update: {},
    create: { email: "workspace-acceptance@sentinel.local", name: "Workspace Acceptance" },
  });
  const tenant = await db.workspace.upsert({
    where: { slug: "workspace-acceptance" },
    update: {},
    create: { slug: "workspace-acceptance", name: "Workspace Acceptance", ownerId: user.id },
  });
  const agent = async (id: string, name: string) => db.agent.upsert({
    where: { id },
    update: {},
    create: { id, name, role: "engineer", avatar: "", color: "#6366F1", model: "claude-opus-5", workspaceId: tenant.id },
  });
  return { user, tenant, nathan: await agent("acceptance-nathan2", "Nathan2"), lisa: await agent("acceptance-lisa", "Lisa") };
}

async function main() {
  const { user, tenant, nathan, lisa } = await fixtures();
  const actor = { userId: user.id, agentId: nathan.id, client: "sentinel-ui" as const };

  const workspace = await createAgentWorkspace({
    agentId: nathan.id,
    tenantWorkspaceId: tenant.id,
    ownerUserId: user.id,
    name: `Acceptance ${Date.now()}`,
    resourceLimits: { cpus: 1, memoryMb: 1024, pidsLimit: 128, commandTimeoutMs: 120_000 },
    actor,
  });
  check("workspace created with a data volume", Boolean(workspace.volumeName), workspace.volumeName ?? "");

  await startRuntime(workspace, actor);
  const running = await reconcileRuntime(workspace);
  check("runtime reports RUNNING from the backend", running?.state === "RUNNING", running?.state);

  const identity = await currentRuntime(workspace.id);
  check("runtime identity is stored in the database, not derived from a name",
    Boolean(identity?.id && identity.containerId), `${identity?.id} / ${identity?.containerId?.slice(0, 12)}`);

  const clone = await runCommand({
    workspace,
    command: "git clone --depth 1 https://github.com/git-fixtures/basic.git repos/basic 2>&1 | tail -2 || true",
    actor,
  });
  const cloned = await runCommand({ workspace, command: "test -d repos/basic/.git && echo cloned", actor });
  const gitAvailable = cloned.stdout.includes("cloned");
  check("repository cloned into the workspace", gitAvailable, gitAvailable ? "repos/basic" : `no network? ${clone.stdout.slice(0, 120)}`);

  await writeFile(workspace, "notes/persistence.txt", "written-before-stop", "utf8", actor);
  const listed = await listFiles(workspace, "notes");
  check("file write is visible in the listing", listed.entries.some((entry) => entry.name === "persistence.txt"));

  await stopRuntime(workspace, actor);
  const stopped = await reconcileRuntime(workspace);
  check("runtime stops without destroying data", stopped?.state === "STOPPED", stopped?.state);

  await startRuntime(workspace, actor);
  const afterRestart = await readFile(workspace, "notes/persistence.txt");
  check("files survive a stop/start cycle", afterRestart.content.trim() === "written-before-stop", afterRestart.content.trim());

  const devServer = await startProcess({
    workspace, label: "acceptance-server", command: "python3 -m http.server 8099", ports: [8099], actor,
  });
  const processes = await listProcesses(workspace);
  check("long-lived process is tracked with a pid",
    Boolean(devServer.pid) && processes.tracked.some((entry) => entry.id === devServer.id && entry.status === "running"),
    `pid ${devServer.pid}`);
  await stopProcess(workspace, devServer.id, actor);

  const snapshot = await createSnapshot({ workspace, name: "pre-risky", reason: "acceptance run", actor });
  check("snapshot created", snapshot.status === "ready" && Number(snapshot.sizeBytes) > 0, `${snapshot.sizeBytes} bytes`);

  await writeFile(workspace, "notes/persistence.txt", "mutated-after-snapshot", "utf8", actor);
  await writeFile(workspace, "notes/extra.txt", "should-disappear", "utf8", actor);

  let refused = false;
  try {
    await restoreSnapshot({ workspace, snapshotId: snapshot.id, confirm: false, actor });
  } catch (error) {
    refused = error instanceof WorkspaceError && error.code === "policy_violation";
  }
  check("restore without explicit confirmation is refused", refused);

  await restoreSnapshot({ workspace, snapshotId: snapshot.id, confirm: true, actor });
  await startRuntime(workspace, actor);
  const restored = await readFile(workspace, "notes/persistence.txt");
  const extraGone = await runCommand({ workspace, command: "test -f notes/extra.txt && echo present || echo absent", actor });
  check("snapshot restore reverts file contents", restored.content.trim() === "written-before-stop", restored.content.trim());
  check("snapshot restore removes files created after the snapshot", extraGone.stdout.trim() === "absent");

  await runCommand({ workspace, command: "mkdir -p out && echo 'id,value' > out/report.csv", actor });
  const artifact = await createArtifact({ workspace, path: "out/report.csv", name: "report.csv", actor });
  check("artifact published from a workspace file",
    (await listArtifacts(workspace.id)).some((entry) => entry.id === artifact.id), artifact.path);

  let isolated = false;
  try {
    await assertAgentMayAccess(workspace, lisa.id, "write");
  } catch (error) {
    isolated = error instanceof WorkspaceError && error.code === "workspace_forbidden";
  }
  check("a second agent cannot touch this workspace without a grant", isolated);

  await grantPermission({ workspace, granteeAgentId: lisa.id, level: "read", reason: "acceptance", actor });
  const readGrant = await assertAgentMayAccess(workspace, lisa.id, "read").then(() => true).catch(() => false);
  const writeStillBlocked = await assertAgentMayAccess(workspace, lisa.id, "write").then(() => false).catch(() => true);
  check("an explicit read grant admits read but not write", readGrant && writeStillBlocked);

  const claudeOk = await authorizeAgentRequest({
    agentWorkspaceId: workspace.id, actingAgentId: nathan.id, client: "claude-code", requiredLevel: "write",
  }).then(() => true).catch(() => false);
  check("Claude Code can act in its own agent's workspace", claudeOk);

  let claudeToCodexBlocked = false;
  try {
    await assertClientHandoffAllowed({ agentWorkspaceId: workspace.id, fromClient: "claude-code", toClient: "codex" });
  } catch (error) {
    claudeToCodexBlocked = error instanceof WorkspaceError && error.code === "policy_violation";
  }
  check("Claude Code cannot delegate to Codex automatically", claudeToCodexBlocked);

  let codexToClaudeBlocked = false;
  try {
    await assertClientHandoffAllowed({ agentWorkspaceId: workspace.id, fromClient: "codex", toClient: "claude-code" });
  } catch (error) {
    codexToClaudeBlocked = error instanceof WorkspaceError && error.code === "policy_violation";
  }
  check("Codex cannot delegate to Claude Code automatically", codexToClaudeBlocked);

  const explicit = await assertClientHandoffAllowed({
    agentWorkspaceId: workspace.id,
    fromClient: "claude-code",
    toClient: "codex",
    authorization: { authorizedByUserId: user.id, reason: "operator explicitly asked to split this task" },
  }).then(() => true).catch(() => false);
  check("an explicitly authorized handoff is allowed", explicit);

  const events = await listWorkspaceEvents(workspace.id, 200);
  const required = ["workspace.created", "workspace.started", "workspace.stopped", "command.executed", "snapshot.created", "snapshot.restored", "permission.changed", "artifact.created", "delegation.blocked"];
  const missing = required.filter((type) => !events.some((event) => event.type === type));
  check("audit trail records every significant event", missing.length === 0, missing.join(", ") || "all present");

  const audits = await db.auditLog.count({ where: { entityType: "AgentWorkspace", entityId: workspace.id } });
  check("events are mirrored into Sentinel's global audit log", audits > 0, `${audits} rows`);

  if (process.env.KEEP_WORKSPACE !== "1") {
    await deleteWorkspaceData(workspace, actor);
    const after = await db.agentWorkspace.findUnique({ where: { id: workspace.id } });
    check("workspace data deletion is a separate, explicit teardown", after?.status === "DELETED" && after.volumeName === null);
    check("snapshots are removed with the workspace data", (await listSnapshots(workspace.id)).length === 0);
  }

  console.log(`\n${results.filter((r) => r.ok).length}/${results.length} checks passed`);
  await db.$disconnect();
}

main().catch(async (error) => {
  console.error("acceptance run failed:", error);
  process.exitCode = 1;
  await db.$disconnect();
});
