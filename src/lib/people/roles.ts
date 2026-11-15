// The vocabulary of membership. Kept free of database imports so client
// components can render role names and descriptions from the same source.

export const ORG_ROLES = ["owner", "admin", "operator", "member"] as const;
export type OrgRole = (typeof ORG_ROLES)[number];

/** Roles an invitation may grant. Ownership is never handed out by link. */
export const INVITABLE_ORG_ROLES = ["admin", "operator", "member"] as const;

export const PROJECT_ROLES = ["editor", "viewer"] as const;
export type ProjectRole = (typeof PROJECT_ROLES)[number];

export const ROLE_COPY: Record<OrgRole | ProjectRole, { label: string; grants: string }> = {
  owner: { label: "Owner", grants: "Everything, including removing admins." },
  admin: { label: "Admin", grants: "Full control: run agents, manage people, change settings." },
  operator: { label: "Operator", grants: "Works in every shared workspace and can run agents. Cannot manage people." },
  member: { label: "Member", grants: "Reads shared workspaces and works on tasks. Cannot run agents." },
  editor: { label: "Editor", grants: "This project only: write in its rooms, tasks and documents. Cannot run agents." },
  viewer: { label: "Viewer", grants: "This project only, read-only." },
};

export function isOrgRole(value: unknown): value is OrgRole {
  return typeof value === "string" && (ORG_ROLES as readonly string[]).includes(value);
}
export function isInvitableOrgRole(value: unknown): value is (typeof INVITABLE_ORG_ROLES)[number] {
  return typeof value === "string" && (INVITABLE_ORG_ROLES as readonly string[]).includes(value);
}
export function isProjectRole(value: unknown): value is ProjectRole {
  return typeof value === "string" && (PROJECT_ROLES as readonly string[]).includes(value);
}

export const canManagePeople = (role: OrgRole | null | undefined) => role === "owner" || role === "admin";

/** Permission keys a project member holds on that one project. */
const VIEWER_KEYS = ["project.read", "task.read", "document.read", "meeting.read"];
const EDITOR_KEYS = [...VIEWER_KEYS, "project.update", "task.create", "task.update", "document.create", "document.update"];

export function projectRoleAllows(role: string, permissionKey: string): boolean {
  if (role === "editor") return EDITOR_KEYS.includes(permissionKey);
  if (role === "viewer") return VIEWER_KEYS.includes(permissionKey);
  return false;
}
