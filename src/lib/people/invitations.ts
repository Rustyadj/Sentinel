import { randomBytes } from "node:crypto";
import { db } from "@/lib/db";
import { normalizeEmail } from "@/lib/auth/email";
import { writeAuditLog } from "@/lib/workspaces/audit";
import { ensureHomeOrganization, getOrgRole, setOrgMember } from "./organization";
import { userCanShareProject } from "./project-access";
import { canManagePeople, isInvitableOrgRole, isProjectRole, type OrgRole } from "./roles";
import { hashInvitationToken } from "./token";

export class InvitationError extends Error {
  constructor(message: string, public readonly status: 400 | 403 | 404 | 409 | 410) {
    super(message);
  }
}

const DEFAULT_DAYS = 7;
const MAX_DAYS = 30;

export { hashInvitationToken };

export interface CreateInvitationInput {
  scope: "organization" | "project";
  role: string;
  projectId?: string;
  email?: string | null;
  note?: string | null;
  expiresInDays?: number;
}

/** Creates an invitation and returns the token exactly once. It cannot be recovered afterwards. */
export async function createInvitation(input: CreateInvitationInput, inviterId: string) {
  const org = await ensureHomeOrganization();
  const days = Math.min(Math.max(Math.round(input.expiresInDays ?? DEFAULT_DAYS), 1), MAX_DAYS);
  const email = input.email?.trim() ? normalizeEmail(input.email) : null;
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new InvitationError("That email address is not valid.", 400);

  let projectId: string | null = null;
  if (input.scope === "organization") {
    if (!isInvitableOrgRole(input.role)) throw new InvitationError("Choose admin, operator or member.", 400);
    if (!canManagePeople(await getOrgRole(inviterId))) throw new InvitationError("Only owners and admins can invite people to the team.", 403);
  } else if (input.scope === "project") {
    if (!isProjectRole(input.role)) throw new InvitationError("Choose editor or viewer.", 400);
    const project = input.projectId
      ? await db.project.findUnique({ where: { id: input.projectId }, select: { id: true, userId: true } })
      : null;
    // The same answer whether the project is missing or simply not the caller's to share.
    if (!project || !(await userCanShareProject(inviterId, project))) throw new InvitationError("Project not found.", 404);
    projectId = project.id;
  } else {
    throw new InvitationError("Unknown invitation scope.", 400);
  }

  const token = randomBytes(32).toString("base64url");
  const invitation = await db.invitation.create({
    data: {
      tokenHash: hashInvitationToken(token),
      scope: input.scope,
      organizationId: input.scope === "organization" ? org.id : null,
      projectId,
      role: input.role,
      email,
      note: input.note?.trim().slice(0, 280) || null,
      invitedById: inviterId,
      expiresAt: new Date(Date.now() + days * 86_400_000),
    },
  });
  await writeAuditLog({
    userId: inviterId, projectId, action: "invitation.created", entityType: "invitation", entityId: invitation.id,
    details: { scope: input.scope, role: input.role, emailBound: Boolean(email), expiresAt: invitation.expiresAt.toISOString() },
  });
  return { invitation, token };
}

export type InvitationState = "pending" | "accepted" | "revoked" | "expired";

export function invitationState(invitation: { acceptedAt: Date | null; revokedAt: Date | null; expiresAt: Date }): InvitationState {
  if (invitation.acceptedAt) return "accepted";
  if (invitation.revokedAt) return "revoked";
  if (invitation.expiresAt <= new Date()) return "expired";
  return "pending";
}

/** Looks an invitation up by its token. Throws unless it can still be accepted. */
export async function findOpenInvitation(token: string) {
  const invitation = typeof token === "string" && token.length >= 20
    ? await db.invitation.findUnique({
        where: { tokenHash: hashInvitationToken(token) },
        include: {
          invitedBy: { select: { name: true, email: true } },
          project: { select: { id: true, name: true } },
          organization: { select: { id: true, name: true } },
        },
      })
    : null;
  if (!invitation) throw new InvitationError("This invitation link is not valid.", 404);
  const state = invitationState(invitation);
  if (state === "accepted") throw new InvitationError("This invitation has already been used.", 410);
  if (state === "revoked") throw new InvitationError("This invitation was withdrawn.", 410);
  if (state === "expired") throw new InvitationError("This invitation has expired. Ask for a new one.", 410);
  return invitation;
}

/** What an invitation offers, safe to show to someone who is not signed in. */
export async function describeInvitation(token: string) {
  const invitation = await findOpenInvitation(token);
  return {
    scope: invitation.scope as "organization" | "project",
    role: invitation.role,
    target: invitation.scope === "project" ? invitation.project?.name ?? "a project" : invitation.organization?.name ?? "the team",
    invitedBy: invitation.invitedBy.name ?? invitation.invitedBy.email,
    note: invitation.note,
    // Whether an address is required, and which, so the form can say so. The
    // token holder is the intended recipient; this tells them nothing new.
    email: invitation.email,
    expiresAt: invitation.expiresAt.toISOString(),
  };
}

/** Whether `email` is the address an invitation was issued to (always true for an unbound link). */
export function invitationAdmits(invitation: { email: string | null }, email: string): boolean {
  return !invitation.email || normalizeEmail(invitation.email) === normalizeEmail(email);
}

/**
 * Grants what the invitation offers to an existing account and spends it.
 * The claim is a conditional update, so two requests racing on one link
 * cannot both win.
 */
export async function acceptInvitation(token: string, user: { id: string; email: string }) {
  const invitation = await findOpenInvitation(token);
  if (!invitationAdmits(invitation, user.email)) {
    throw new InvitationError("This invitation was issued to a different email address.", 403);
  }

  const claimed = await db.invitation.updateMany({
    where: { id: invitation.id, acceptedAt: null, revokedAt: null, expiresAt: { gt: new Date() } },
    data: { acceptedAt: new Date(), acceptedById: user.id },
  });
  if (claimed.count !== 1) throw new InvitationError("This invitation has already been used.", 410);

  if (invitation.scope === "organization") {
    const current = await getOrgRole(user.id);
    // Never lowers anyone: an owner or admin following a member link keeps their role.
    const rank: Record<OrgRole, number> = { member: 1, operator: 2, admin: 3, owner: 4 };
    if (!current || rank[invitation.role as OrgRole] > rank[current]) {
      await setOrgMember({ userId: user.id, role: invitation.role as OrgRole, actorId: invitation.invitedById });
    }
  } else if (invitation.projectId) {
    const project = await db.project.findUnique({ where: { id: invitation.projectId }, select: { userId: true } });
    if (project && project.userId !== user.id) {
      const existing = await db.projectMember.findUnique({
        where: { projectId_userId: { projectId: invitation.projectId, userId: user.id } },
      });
      // Same rule: an editor following a viewer link stays an editor.
      if (!existing || (existing.role === "viewer" && invitation.role === "editor")) {
        await db.projectMember.upsert({
          where: { projectId_userId: { projectId: invitation.projectId, userId: user.id } },
          update: { role: invitation.role },
          create: { projectId: invitation.projectId, userId: user.id, role: invitation.role, addedById: invitation.invitedById },
        });
      }
    }
  }

  await writeAuditLog({
    userId: user.id, projectId: invitation.projectId, action: "invitation.accepted", entityType: "invitation", entityId: invitation.id,
    details: { scope: invitation.scope, role: invitation.role },
  });
  return { scope: invitation.scope as "organization" | "project", projectId: invitation.projectId };
}

/** Invitations the caller may see: everything for people managers, otherwise only the ones they sent. */
export async function listInvitations(userId: string) {
  const manages = canManagePeople(await getOrgRole(userId));
  const rows = await db.invitation.findMany({
    where: manages ? {} : { invitedById: userId },
    include: {
      invitedBy: { select: { name: true, email: true } },
      acceptedBy: { select: { name: true, email: true } },
      project: { select: { id: true, name: true } },
    },
    orderBy: { createdAt: "desc" },
    take: 100,
  });
  return rows.map((row) => ({
    id: row.id, scope: row.scope, role: row.role, email: row.email, note: row.note,
    project: row.project, state: invitationState(row), createdAt: row.createdAt, expiresAt: row.expiresAt,
    invitedBy: row.invitedBy.name ?? row.invitedBy.email,
    acceptedBy: row.acceptedBy ? row.acceptedBy.name ?? row.acceptedBy.email : null,
  }));
}

export async function revokeInvitation(id: string, userId: string) {
  const invitation = await db.invitation.findUnique({ where: { id } });
  const manages = canManagePeople(await getOrgRole(userId));
  if (!invitation || (!manages && invitation.invitedById !== userId)) throw new InvitationError("Invitation not found.", 404);
  if (invitationState(invitation) !== "pending") throw new InvitationError("Only a pending invitation can be withdrawn.", 409);
  await db.invitation.update({ where: { id }, data: { revokedAt: new Date() } });
  await writeAuditLog({ userId, projectId: invitation.projectId, action: "invitation.revoked", entityType: "invitation", entityId: id });
}
