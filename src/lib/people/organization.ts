import { db } from "@/lib/db";
import { ensureOperatorRole, ensureSystemRoles } from "@/lib/workspaces/permissions-catalog";
import { writeAuditLog } from "@/lib/workspaces/audit";
import type { OrgRole } from "./roles";

/** Workspaces every member is enrolled in. Mirrors DEFAULT_WORKSPACES in workspaces/objects.ts. */
export const SHARED_WORKSPACE_SLUGS = ["cybersecurity", "organization", "studio", "marketing"];
/** Never shared through organization membership, whoever owns it. */
const PRIVATE_WORKSPACE_SLUGS = ["personal"];

/**
 * The organization this instance belongs to. Sentinel is one team's
 * deployment, so there is one: created on first use, owned by whoever owns the
 * shared "organization" workspace (or the oldest account on a fresh install).
 *
 * Accounts that existed before organizations did are recorded as members, at
 * the access they already had. Recording them changes nothing they can reach:
 * no role assignment is created here.
 */
export async function ensureHomeOrganization() {
  const existing = await db.organization.findFirst({ orderBy: { createdAt: "asc" } });
  if (existing) return existing;

  const anchor = await db.workspace.findFirst({ where: { slug: "organization" }, select: { ownerId: true } });
  const owner = anchor
    ? await db.user.findUnique({ where: { id: anchor.ownerId } })
    : await db.user.findFirst({ orderBy: { createdAt: "asc" } });
  if (!owner) throw new Error("An organization needs at least one account.");

  return db.$transaction(async (tx) => {
    // Two first requests can race here; the lock makes the second one find the row.
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('sentinel:home-organization'))`;
    const raced = await tx.organization.findFirst({ orderBy: { createdAt: "asc" } });
    if (raced) return raced;

    const org = await tx.organization.create({
      data: { name: owner.name ? `${owner.name}'s team` : "Sentinel team", ownerId: owner.id },
    });
    const others = await tx.user.findMany({ where: { id: { not: owner.id }, accessScope: "member" }, select: { id: true } });
    await tx.organizationMember.createMany({
      data: [
        { organizationId: org.id, userId: owner.id, role: "owner" },
        ...others.map((u) => ({ organizationId: org.id, userId: u.id, role: "member" })),
      ],
    });
    await tx.workspace.updateMany({
      where: { ownerId: owner.id, organizationId: null, slug: { notIn: PRIVATE_WORKSPACE_SLUGS } },
      data: { organizationId: org.id },
    });
    return org;
  });
}

export async function getOrgRole(userId: string): Promise<OrgRole | null> {
  const org = await ensureHomeOrganization();
  const membership = await db.organizationMember.findUnique({
    where: { organizationId_userId: { organizationId: org.id, userId } },
    select: { role: true },
  });
  return (membership?.role as OrgRole | undefined) ?? null;
}

async function orgWorkspaces(organizationId: string) {
  // Workspaces the owner created after the organization existed belong to it too.
  const org = await db.organization.findUnique({ where: { id: organizationId }, select: { ownerId: true } });
  if (org?.ownerId) {
    await db.workspace.updateMany({
      where: { ownerId: org.ownerId, organizationId: null, slug: { notIn: PRIVATE_WORKSPACE_SLUGS } },
      data: { organizationId },
    });
  }
  return db.workspace.findMany({
    where: { organizationId, slug: { notIn: PRIVATE_WORKSPACE_SLUGS } },
    select: { id: true, slug: true, ownerId: true },
  });
}

/**
 * Makes a member's workspace role assignments match their organization role.
 * This is the only place membership turns into permissions:
 *   member    Member in the four shared workspaces (what every account had)
 *   operator  Operator in every organization workspace, so they can run agents
 *   admin     Owner in every organization workspace
 * Assignments this function did not create (custom roles, delegations, teams)
 * are left alone; it only manages the three system roles.
 */
export async function syncOrgRoleAssignments(organizationId: string, userId: string, role: OrgRole | null) {
  const workspaces = await orgWorkspaces(organizationId);
  for (const workspace of workspaces) {
    if (workspace.ownerId === userId) continue; // ownership already grants everything
    const { ownerRole, memberRole } = await ensureSystemRoles(workspace.id);
    const operatorRole = await ensureOperatorRole(workspace.id);
    const managed = [ownerRole.id, memberRole.id, operatorRole.id];

    const wanted =
      role === "admin" || role === "owner" ? ownerRole.id
      : role === "operator" ? operatorRole.id
      : role === "member" && SHARED_WORKSPACE_SLUGS.includes(workspace.slug) ? memberRole.id
      : null;

    await db.$transaction(async (tx) => {
      await tx.roleAssignment.deleteMany({
        where: { workspaceId: workspace.id, userId, roleId: { in: managed.filter((id) => id !== wanted) }, delegatedById: null },
      });
      if (!wanted) return;
      const has = await tx.roleAssignment.findFirst({ where: { workspaceId: workspace.id, userId, roleId: wanted } });
      if (!has) await tx.roleAssignment.create({ data: { workspaceId: workspace.id, userId, roleId: wanted } });
    });
  }
}

export async function setOrgMember(input: { userId: string; role: OrgRole; actorId: string }) {
  const org = await ensureHomeOrganization();
  if (input.role === "owner") throw new Error("Ownership cannot be assigned.");
  const current = await db.organizationMember.findUnique({
    where: { organizationId_userId: { organizationId: org.id, userId: input.userId } },
  });
  if (current?.role === "owner") throw new Error("The owner's role cannot be changed.");

  await db.$transaction([
    db.organizationMember.upsert({
      where: { organizationId_userId: { organizationId: org.id, userId: input.userId } },
      update: { role: input.role },
      create: { organizationId: org.id, userId: input.userId, role: input.role },
    }),
    // Joining the organization ends guest status: the account is now enrolled like any member.
    db.user.update({ where: { id: input.userId }, data: { accessScope: "member" } }),
  ]);
  await syncOrgRoleAssignments(org.id, input.userId, input.role);
  await writeAuditLog({
    userId: input.actorId, action: current ? "organization.member_role_changed" : "organization.member_added",
    entityType: "organizationMember", entityId: input.userId, details: { role: input.role, previous: current?.role ?? null },
  });
}

/**
 * Removal has to stick. A "member" account is re-enrolled in the shared
 * workspaces the next time it lists them, so the account drops to guest scope
 * along with losing its assignments. Project memberships are kept: being asked
 * to leave the team is not the same as being taken off a project.
 */
export async function removeOrgMember(input: { userId: string; actorId: string }) {
  const org = await ensureHomeOrganization();
  const current = await db.organizationMember.findUnique({
    where: { organizationId_userId: { organizationId: org.id, userId: input.userId } },
  });
  if (!current) return;
  if (current.role === "owner") throw new Error("The owner cannot be removed.");

  await db.$transaction([
    db.organizationMember.delete({ where: { id: current.id } }),
    db.user.update({ where: { id: input.userId }, data: { accessScope: "guest" } }),
  ]);
  await syncOrgRoleAssignments(org.id, input.userId, null);
  await writeAuditLog({
    userId: input.actorId, action: "organization.member_removed",
    entityType: "organizationMember", entityId: input.userId, details: { role: current.role },
  });
}

export async function listOrgMembers() {
  const org = await ensureHomeOrganization();
  const members = await db.organizationMember.findMany({
    where: { organizationId: org.id },
    include: { user: { select: { id: true, name: true, email: true, createdAt: true } } },
    orderBy: { createdAt: "asc" },
  });
  return { organization: { id: org.id, name: org.name }, members };
}
