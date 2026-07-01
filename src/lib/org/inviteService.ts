// Mock invite service — swap backing store for DB later without touching UI

import type { OrgInvite, InviteStatus } from "./types";

const _store: OrgInvite[] = [
  {
    id: "inv-001",
    orgId: "org-1",
    email: "andrea@example.com",
    roleId: "admin",
    departmentId: "dept-eng",
    title: "VP Engineering",
    workspaceAccess: ["dashboard", "chat", "builder", "workflows"],
    defaultAgentTeamId: "team-alpha",
    invitedByMemberId: "member-1",
    status: "pending",
    expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
    createdAt: new Date(Date.now() - 2 * 60 * 60 * 1000),
  },
  {
    id: "inv-002",
    orgId: "org-1",
    email: "sheryl@example.com",
    roleId: "member",
    departmentId: "dept-ops",
    title: "Operations Lead",
    workspaceAccess: ["dashboard", "kanban", "workflows"],
    invitedByMemberId: "member-1",
    status: "pending",
    expiresAt: new Date(Date.now() + 6 * 24 * 60 * 60 * 1000),
    createdAt: new Date(Date.now() - 24 * 60 * 60 * 1000),
  },
];

export interface CreateInviteInput {
  email: string;
  roleId: string;
  departmentId?: string;
  title?: string;
  workspaceAccess: string[];
  defaultAgentTeamId?: string;
}

export function listInvites(orgId: string): OrgInvite[] {
  return _store.filter((i) => i.orgId === orgId && i.status === "pending");
}

export function createInvite(orgId: string, input: CreateInviteInput, invitedByMemberId: string): OrgInvite {
  const invite: OrgInvite = {
    id: `inv-${Date.now()}`,
    orgId,
    email: input.email,
    roleId: input.roleId,
    departmentId: input.departmentId,
    title: input.title,
    workspaceAccess: input.workspaceAccess,
    defaultAgentTeamId: input.defaultAgentTeamId,
    invitedByMemberId,
    status: "pending",
    expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
    createdAt: new Date(),
  };
  _store.push(invite);
  return invite;
}

export function revokeInvite(inviteId: string): void {
  const inv = _store.find((i) => i.id === inviteId);
  if (inv) inv.status = "revoked";
}

export function acceptInvite(token: string): OrgInvite | null {
  // token === inviteId in mock
  const inv = _store.find((i) => i.id === token && i.status === "pending");
  if (inv && inv.expiresAt > new Date()) {
    inv.status = "accepted";
    return inv;
  }
  return null;
}
