import { createHash } from "node:crypto";
import type { AgentWorkspace } from "@prisma/client";
import { db } from "@/lib/db";
import { WorkspaceError } from "./errors";
import { recordWorkspaceEvent } from "./events";
import { MAX_FILE_READ_BYTES, resolveWorkspacePath } from "./policy";
import { getRuntimeProvider } from "./providers";
import { runCommand } from "./exec";
import { recordWorkspaceMemoryReference } from "./memory-link";
import { requireRunningRuntime, type ActorContext } from "./service";

const CONTENT_TYPES: Record<string, string> = {
  pdf: "application/pdf", zip: "application/zip", png: "image/png", jpg: "image/jpeg",
  jpeg: "image/jpeg", gif: "image/gif", svg: "image/svg+xml", csv: "text/csv",
  json: "application/json", md: "text/markdown", txt: "text/plain", html: "text/html",
  mp4: "video/mp4", webm: "video/webm", log: "text/plain",
};

function contentTypeFor(path: string) {
  return CONTENT_TYPES[path.split(".").pop()?.toLowerCase() ?? ""] ?? "application/octet-stream";
}

/**
 * Promote a workspace file to a first-class artifact so operators never have to
 * dig through the filesystem. The artifact references the file; content is
 * streamed on demand rather than copied into Postgres.
 */
export async function createArtifact(input: {
  workspace: AgentWorkspace;
  path: string;
  name?: string;
  description?: string;
  projectId?: string | null;
  chatRoomId?: string | null;
  actor: ActorContext;
}) {
  const { workspace, actor } = input;
  await requireRunningRuntime(workspace);
  const path = resolveWorkspacePath(workspace.homePath, input.path);

  const probe = await runCommand({
    workspace,
    command: `test -f '${path.replace(/'/g, `'\\''`)}' && stat -c '%s' '${path.replace(/'/g, `'\\''`)}' && sha256sum '${path.replace(/'/g, `'\\''`)}' | cut -d' ' -f1`,
    actor,
    metadata: { via: "artifact.probe" },
  });
  if (probe.exitCode !== 0) throw new WorkspaceError("The referenced file does not exist in this workspace.", "file_not_found");
  const [size, checksum] = probe.stdout.trim().split("\n");

  const artifact = await db.workspaceArtifact.create({
    data: {
      agentWorkspaceId: workspace.id,
      agentId: actor.agentId ?? workspace.agentId,
      createdByUserId: actor.userId ?? null,
      name: input.name?.trim() || path.split("/").pop() || "artifact",
      description: input.description?.trim() || null,
      path,
      contentType: contentTypeFor(path),
      sizeBytes: BigInt(Number.parseInt(size, 10) || 0),
      checksum: checksum ?? null,
      projectId: input.projectId ?? null,
      chatRoomId: input.chatRoomId ?? null,
    },
  });
  await recordWorkspaceEvent({
    agentWorkspaceId: workspace.id,
    tenantWorkspaceId: workspace.workspaceId,
    type: "artifact.created",
    message: `Artifact "${artifact.name}" published from ${path}.`,
    actorUserId: actor.userId ?? null,
    actorAgentId: actor.agentId ?? workspace.agentId,
    source: actor.client,
    metadata: { artifactId: artifact.id, path, sizeBytes: size },
  });
  await recordWorkspaceMemoryReference({
    workspace,
    content: `${workspace.agentId} published artifact "${artifact.name}" from workspace "${workspace.name}" (${path}).`,
    tags: ["artifact"],
  });
  return artifact;
}

export async function listArtifacts(agentWorkspaceId: string) {
  return db.workspaceArtifact.findMany({ where: { agentWorkspaceId }, orderBy: [{ pinned: "desc" }, { createdAt: "desc" }] });
}

export async function setArtifactPinned(workspace: AgentWorkspace, artifactId: string, pinned: boolean) {
  const artifact = await db.workspaceArtifact.findFirst({ where: { id: artifactId, agentWorkspaceId: workspace.id } });
  if (!artifact) throw new WorkspaceError("Artifact not found.", "workspace_not_found");
  return db.workspaceArtifact.update({ where: { id: artifact.id }, data: { pinned } });
}

export async function deleteArtifact(workspace: AgentWorkspace, artifactId: string, actor: ActorContext) {
  const artifact = await db.workspaceArtifact.findFirst({ where: { id: artifactId, agentWorkspaceId: workspace.id } });
  if (!artifact) throw new WorkspaceError("Artifact not found.", "workspace_not_found");
  // Removing the artifact record never deletes the underlying workspace file.
  await db.workspaceArtifact.delete({ where: { id: artifact.id } });
  await recordWorkspaceEvent({
    agentWorkspaceId: workspace.id,
    tenantWorkspaceId: workspace.workspaceId,
    type: "artifact.deleted",
    message: `Artifact "${artifact.name}" removed from the artifact list. The workspace file was kept.`,
    actorUserId: actor.userId ?? null,
    source: actor.client,
    metadata: { artifactId: artifact.id, path: artifact.path },
  });
}

/** Read artifact bytes for preview/download. */
export async function readArtifact(workspace: AgentWorkspace, artifactId: string) {
  const artifact = await db.workspaceArtifact.findFirst({ where: { id: artifactId, agentWorkspaceId: workspace.id } });
  if (!artifact) throw new WorkspaceError("Artifact not found.", "workspace_not_found");
  await requireRunningRuntime(workspace);
  const file = await getRuntimeProvider(workspace.runtimeType).readFile(workspace.id, artifact.path, MAX_FILE_READ_BYTES);
  const buffer = file.encoding === "base64" ? Buffer.from(file.content, "base64") : Buffer.from(file.content, "utf8");
  const checksum = createHash("sha256").update(buffer).digest("hex");
  return { artifact, buffer, checksum };
}
