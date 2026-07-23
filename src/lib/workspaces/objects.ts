import { db } from "@/lib/db";
import { writeAuditLog } from "./audit";
import { ensureMemberAccess, ensureSystemRoles } from "./permissions-catalog";

const DEFAULT_WORKSPACES = [
  {
    slug: "cybersecurity",
    name: "Cybersecurity",
    description: "Red and blue team operations, threat intelligence, and attack simulation.",
    kind: "security",
    color: "#EF4444",
    icon: "Shield",
  },
  {
    slug: "organization",
    name: "Organization",
    description: "Teams, projects, approvals, meetings, and access control.",
    kind: "organization",
    color: "#3B82F6",
    icon: "Building2",
  },
  {
    slug: "studio",
    name: "Studio",
    description: "AI-powered application and design workspace.",
    kind: "studio",
    color: "#8B5CF6",
    icon: "Wand2",
  },
  {
    slug: "marketing",
    name: "Marketing",
    description: "Campaign, content, and growth operations.",
    kind: "marketing",
    color: "#F59E0B",
    icon: "Megaphone",
  },
] as const;

export async function ensureDefaultWorkspaces(ownerId: string) {
  const workspaces = await db.$transaction(
    DEFAULT_WORKSPACES.map((workspace) =>
      db.workspace.upsert({
        where: { slug: workspace.slug },
        update: {},
        create: { ...workspace, ownerId },
      })
    )
  );

  for (const workspace of workspaces) {
    await ensureSystemRoles(workspace.id);
    if (workspace.ownerId !== ownerId) {
      await ensureMemberAccess(workspace.id, ownerId);
    }
  }
}

export async function listWorkspaces(ownerId?: string) {
  if (ownerId) await ensureDefaultWorkspaces(ownerId);
  return db.workspace.findMany({
    where: ownerId ? { OR: [{ ownerId }, { roleAssignments: { some: { userId: ownerId } } }] } : undefined,
    include: { _count: { select: { projects: true, teams: true, approvals: true } } },
    orderBy: { createdAt: "asc" },
  });
}

export function getWorkspaceBySlug(slug: string) {
  return db.workspace.findUnique({
    where: { slug },
    include: { _count: { select: { projects: true, teams: true, approvals: true, meetings: true } } },
  });
}

export async function createWorkspace(
  input: { slug: string; name: string; description?: string; kind?: string; color?: string; icon?: string },
  ownerId: string
) {
  const workspace = await db.workspace.create({
    data: { ...input, ownerId },
  });
  await ensureSystemRoles(workspace.id);
  await writeAuditLog({
    workspaceId: workspace.id,
    userId: ownerId,
    action: "workspace.created",
    entityType: "workspace",
    entityId: workspace.id,
    details: { slug: workspace.slug, name: workspace.name },
  });
  return workspace;
}

export async function updateWorkspace(
  id: string,
  input: { name?: string; description?: string | null; color?: string; icon?: string; enabled?: boolean },
  userId: string
) {
  const workspace = await db.workspace.update({ where: { id }, data: input });
  await writeAuditLog({
    workspaceId: id,
    userId,
    action: "workspace.updated",
    entityType: "workspace",
    entityId: id,
    details: input,
  });
  return workspace;
}

export async function deleteWorkspace(id: string, userId: string) {
  await writeAuditLog({
    workspaceId: id,
    userId,
    action: "workspace.deleted",
    entityType: "workspace",
    entityId: id,
  });
  return db.workspace.delete({ where: { id } });
}
