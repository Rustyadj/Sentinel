import { auth } from "@/auth";
import { db } from "@/lib/db";
import { getVpsAgent } from "./registry";
export { canEditConfig, canRestartAgent, canViewAgent } from "./policy";
import type { ControlPlaneRole } from "./policy";
export type { ControlPlaneRole } from "./policy";

export interface AuthorizedUser {
  id: string;
  email: string;
  role: ControlPlaneRole;
  workspaceId: string;
}

function roleRank(role: ControlPlaneRole) {
  return role === "owner" ? 3 : role === "admin" ? 2 : 1;
}

async function resolveWorkspaceRole(userId: string, workspaceId: string): Promise<ControlPlaneRole | null> {
  const workspace = await db.workspace.findUnique({
    where: { id: workspaceId },
    select: { ownerId: true },
  });
  if (!workspace) return null;
  if (workspace.ownerId === userId) return "owner";

  const assignments = await db.roleAssignment.findMany({
    where: {
      workspaceId,
      OR: [{ userId }, { team: { memberUserIds: { has: userId } } }],
      AND: [{ OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }] }],
    },
    select: { role: { select: { name: true, permissions: { select: { key: true } } } } },
  });
  if (!assignments.length) return null;
  const privileged = assignments.some(({ role }) =>
    role.name.toLowerCase() === "admin" ||
    role.name.toLowerCase() === "owner" ||
    role.permissions.some(({ key }) => key === "*")
  );
  return privileged ? "admin" : "member";
}

async function currentDbUser() {
  const session = await auth();
  if (!session?.user?.email) return null;
  return db.user.findUnique({ where: { email: session.user.email } });
}

export async function getAccessibleWorkspaceIds(userId: string) {
  const workspaces = await db.workspace.findMany({
    where: {
      OR: [
        { ownerId: userId },
        { roleAssignments: { some: { OR: [{ userId }, { team: { memberUserIds: { has: userId } } }] } } },
      ],
    },
    select: { id: true },
  });
  return workspaces.map(({ id }) => id);
}

export async function getWorkspaceControlPlaneUser(workspaceId: string): Promise<AuthorizedUser | null> {
  const user = await currentDbUser();
  if (!user) return null;
  const role = await resolveWorkspaceRole(user.id, workspaceId);
  return role ? { id: user.id, email: user.email, role, workspaceId } : null;
}

export async function getControlPlaneUser(agentId?: string): Promise<AuthorizedUser | null> {
  try {
    const user = await currentDbUser();
    if (!user) return null;

    if (agentId) {
      const agent = getVpsAgent(agentId);
      if (!agent) return null;
      const workspace = await db.workspace.findUnique({ where: { slug: agent.workspaceId }, select: { id: true } });
      if (!workspace) return null;
      const role = await resolveWorkspaceRole(user.id, workspace.id);
      return role ? { id: user.id, email: user.email, role, workspaceId: workspace.id } : null;
    }

    const workspaceIds = await getAccessibleWorkspaceIds(user.id);
    const workspaces = workspaceIds.map((id) => ({ id }));
    const roles = (await Promise.all(workspaces.map(async ({ id }) => ({ id, role: await resolveWorkspaceRole(user.id, id) }))))
      .filter((item): item is { id: string; role: ControlPlaneRole } => Boolean(item.role))
      .sort((a, b) => roleRank(b.role) - roleRank(a.role));
    return roles[0] ? { id: user.id, email: user.email, role: roles[0].role, workspaceId: roles[0].id } : null;
  } catch {
    return null;
  }
}

export async function requireAgentRecordUser(agentId: string, write = false) {
  const user = await currentDbUser();
  if (!user) return null;
  const agent = await db.agent.findUnique({ where: { id: agentId }, select: { workspaceId: true } });
  if (!agent) return null;
  if (agent.workspaceId) {
    const role = await resolveWorkspaceRole(user.id, agent.workspaceId);
    if (!role || (write && role === "member")) return null;
    return { id: user.id, email: user.email, role, workspaceId: agent.workspaceId };
  }
  const global = await getControlPlaneUser();
  return global && global.role !== "member" ? global : null;
}

export function unauthorized() { return Response.json({ error: "Unauthorized" }, { status: 401 }); }
export function forbidden(action: string) {
  return Response.json({ error: `Forbidden: requires owner or admin to ${action}` }, { status: 403 });
}
