import type { AgentWorkspace } from "@prisma/client";
import { recordWorkspaceEvent } from "./events";
import { MAX_FILE_READ_BYTES, MAX_FILE_WRITE_BYTES, resolveWorkspacePath } from "./policy";
import { getRuntimeProvider } from "./providers";
import { requireRunningRuntime, type ActorContext } from "./service";
import { WorkspaceError } from "./errors";

function provider(workspace: AgentWorkspace) {
  return getRuntimeProvider(workspace.runtimeType);
}

export async function listFiles(workspace: AgentWorkspace, path?: string) {
  await requireRunningRuntime(workspace);
  const resolved = resolveWorkspacePath(workspace.homePath, path);
  return { path: resolved, entries: await provider(workspace).listFiles(workspace.id, resolved) };
}

export async function readFile(workspace: AgentWorkspace, path: string) {
  await requireRunningRuntime(workspace);
  const resolved = resolveWorkspacePath(workspace.homePath, path);
  const file = await provider(workspace).readFile(workspace.id, resolved, MAX_FILE_READ_BYTES);
  return { path: resolved, ...file };
}

export async function writeFile(
  workspace: AgentWorkspace,
  path: string,
  content: string,
  encoding: "utf8" | "base64",
  actor: ActorContext,
) {
  await requireRunningRuntime(workspace);
  const resolved = resolveWorkspacePath(workspace.homePath, path);
  const byteLength = encoding === "base64" ? Math.ceil(content.length * 0.75) : Buffer.byteLength(content, "utf8");
  if (byteLength > MAX_FILE_WRITE_BYTES) {
    throw new WorkspaceError(`File exceeds the ${Math.round(MAX_FILE_WRITE_BYTES / 1024 / 1024)} MB write limit.`, "file_too_large");
  }
  await provider(workspace).writeFile(workspace.id, resolved, content, encoding);
  await recordWorkspaceEvent({
    agentWorkspaceId: workspace.id,
    tenantWorkspaceId: workspace.workspaceId,
    type: "file.modified",
    message: `Wrote ${resolved}`,
    actorUserId: actor.userId ?? null,
    actorAgentId: actor.agentId ?? workspace.agentId,
    source: actor.client,
    metadata: { path: resolved, bytes: byteLength },
  });
  return { path: resolved, sizeBytes: byteLength };
}

export async function deletePath(workspace: AgentWorkspace, path: string, recursive: boolean, actor: ActorContext) {
  await requireRunningRuntime(workspace);
  const resolved = resolveWorkspacePath(workspace.homePath, path);
  if (resolved === workspace.homePath) {
    throw new WorkspaceError("The workspace root cannot be deleted. Use Delete Workspace Data instead.", "invalid_body");
  }
  await provider(workspace).deletePath(workspace.id, resolved, recursive);
  await recordWorkspaceEvent({
    agentWorkspaceId: workspace.id,
    tenantWorkspaceId: workspace.workspaceId,
    type: "file.deleted",
    severity: "warn",
    message: `Deleted ${resolved}`,
    actorUserId: actor.userId ?? null,
    actorAgentId: actor.agentId ?? workspace.agentId,
    source: actor.client,
    metadata: { path: resolved, recursive },
  });
}

export async function movePath(workspace: AgentWorkspace, from: string, to: string, actor: ActorContext) {
  await requireRunningRuntime(workspace);
  const source = resolveWorkspacePath(workspace.homePath, from);
  const target = resolveWorkspacePath(workspace.homePath, to);
  await provider(workspace).movePath(workspace.id, source, target);
  await recordWorkspaceEvent({
    agentWorkspaceId: workspace.id,
    tenantWorkspaceId: workspace.workspaceId,
    type: "file.moved",
    message: `Moved ${source} to ${target}`,
    actorUserId: actor.userId ?? null,
    source: actor.client,
    metadata: { from: source, to: target },
  });
  return { from: source, to: target };
}

export async function copyPath(workspace: AgentWorkspace, from: string, to: string, actor: ActorContext) {
  await requireRunningRuntime(workspace);
  const source = resolveWorkspacePath(workspace.homePath, from);
  const target = resolveWorkspacePath(workspace.homePath, to);
  await provider(workspace).copyPath(workspace.id, source, target);
  await recordWorkspaceEvent({
    agentWorkspaceId: workspace.id,
    tenantWorkspaceId: workspace.workspaceId,
    type: "file.copied",
    message: `Copied ${source} to ${target}`,
    actorUserId: actor.userId ?? null,
    source: actor.client,
    metadata: { from: source, to: target },
  });
  return { from: source, to: target };
}

export async function searchFiles(workspace: AgentWorkspace, query: string, root?: string, limit = 100) {
  await requireRunningRuntime(workspace);
  if (!query.trim()) throw new WorkspaceError("Search query is required.", "invalid_body");
  const resolved = resolveWorkspacePath(workspace.homePath, root);
  return provider(workspace).searchFiles(workspace.id, resolved, query, Math.min(Math.max(limit, 1), 500));
}
