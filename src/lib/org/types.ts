// Core org-hierarchy types — platform layer, not just UI

export type RoleLevel = "owner" | "admin" | "manager" | "member" | "guest" | "viewer";

export type PermissionKey =
  | "org:read"
  | "org:write"
  | "org:invite"
  | "org:billing"
  | "agents:read"
  | "agents:write"
  | "agents:deploy"
  | "memory:read"
  | "memory:write"
  | "workflows:read"
  | "workflows:write"
  | "workflows:execute"
  | "projects:read"
  | "projects:write"
  | "studio:read"
  | "studio:write"
  | "security:read"
  | "security:write";

export interface Permission {
  key: PermissionKey;
  label: string;
  description: string;
}

export interface Role {
  id: string;
  name: string;
  level: RoleLevel;
  permissions: PermissionKey[];
  isSystem: boolean; // system roles can't be deleted
  color: string;
}

export interface Department {
  id: string;
  name: string;
  headMemberId?: string;
  parentDepartmentId?: string;
  agentTeamIds: string[];
  color: string;
}

export interface Member {
  id: string;
  userId: string;
  orgId: string;
  name: string;
  email: string;
  avatar?: string;
  roleId: string;
  departmentId?: string;
  title?: string;
  reportingToMemberId?: string;
  agentAssignments: AgentAssignment[];
  joinedAt: Date;
  status: "active" | "suspended" | "pending";
}

export interface ReportingLine {
  managerId: string;
  reportId: string;
  type: "direct" | "dotted";
}

export interface AgentAssignment {
  agentId: string;
  memberId: string;
  scope: "personal" | "team" | "department" | "org";
  permissions: Array<"read" | "write" | "execute" | "manage">;
  assignedAt: Date;
}

export interface ApprovalStep {
  order: number;
  approverId: string; // memberId or roleId
  approverType: "member" | "role" | "department_head";
  required: boolean;
}

export interface ApprovalRoute {
  id: string;
  name: string;
  trigger: string; // e.g. "agent:deploy", "workflow:publish"
  steps: ApprovalStep[];
  onReject: "cancel" | "escalate" | "notify";
}

export interface Organization {
  id: string;
  name: string;
  slug: string;
  logoUrl?: string;
  plan: "free" | "pro" | "enterprise";
  members: Member[];
  departments: Department[];
  roles: Role[];
  approvalRoutes: ApprovalRoute[];
  createdAt: Date;
}

// Invite flow types
export type InviteStatus = "pending" | "accepted" | "expired" | "revoked";

export interface OrgInvite {
  id: string;
  orgId: string;
  email: string;
  roleId: string;
  departmentId?: string;
  title?: string;
  workspaceAccess: string[]; // module ids
  defaultAgentTeamId?: string;
  invitedByMemberId: string;
  status: InviteStatus;
  expiresAt: Date;
  createdAt: Date;
}

// Default system roles
export const SYSTEM_ROLES: Role[] = [
  {
    id: "owner",
    name: "Owner",
    level: "owner",
    isSystem: true,
    color: "#F59E0B",
    permissions: [
      "org:read", "org:write", "org:invite", "org:billing",
      "agents:read", "agents:write", "agents:deploy",
      "memory:read", "memory:write",
      "workflows:read", "workflows:write", "workflows:execute",
      "projects:read", "projects:write",
      "studio:read", "studio:write",
      "security:read", "security:write",
    ],
  },
  {
    id: "admin",
    name: "Admin",
    level: "admin",
    isSystem: true,
    color: "#8B5CF6",
    permissions: [
      "org:read", "org:write", "org:invite",
      "agents:read", "agents:write", "agents:deploy",
      "memory:read", "memory:write",
      "workflows:read", "workflows:write", "workflows:execute",
      "projects:read", "projects:write",
      "studio:read", "studio:write",
      "security:read",
    ],
  },
  {
    id: "manager",
    name: "Manager",
    level: "manager",
    isSystem: true,
    color: "#06B6D4",
    permissions: [
      "org:read", "org:invite",
      "agents:read", "agents:write",
      "memory:read", "memory:write",
      "workflows:read", "workflows:write", "workflows:execute",
      "projects:read", "projects:write",
      "studio:read", "studio:write",
    ],
  },
  {
    id: "member",
    name: "Member",
    level: "member",
    isSystem: true,
    color: "#10B981",
    permissions: [
      "org:read",
      "agents:read",
      "memory:read", "memory:write",
      "workflows:read", "workflows:execute",
      "projects:read", "projects:write",
      "studio:read", "studio:write",
    ],
  },
  {
    id: "guest",
    name: "Guest",
    level: "guest",
    isSystem: true,
    color: "#64748B",
    permissions: ["org:read", "projects:read"],
  },
];
