"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import {
  assignRole,
  createApproval,
  createMeeting,
  createPermission,
  createProject,
  createRole,
  createTeam,
  decideApproval,
  revokeRoleAssignment,
  updateTeam,
} from "@/lib/workspaces";
import { writeAuditLog } from "@/lib/workspaces/audit";
import { requireWorkspacePermission } from "@/lib/workspaces/authorization";
import { assertOneOf, TASK_PRIORITIES, TASK_STATUSES, type TaskPriority, type TaskStatus } from "@/lib/workspaces/status";

function required(formData: FormData, key: string) {
  const value = String(formData.get(key) ?? "").trim();
  if (!value) throw new Error(`${key} is required`);
  return value;
}

function optional(formData: FormData, key: string) {
  const value = String(formData.get(key) ?? "").trim();
  return value || undefined;
}

function ids(formData: FormData, key: string) {
  return String(formData.get(key) ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
}

function refresh(workspaceSlug: string, section: string) {
  revalidatePath(`/workspaces/${workspaceSlug}/${section}`);
  revalidatePath(`/workspaces/${workspaceSlug}`);
}

export async function createTeamAction(formData: FormData) {
  const workspaceId = required(formData, "workspaceId");
  const workspaceSlug = required(formData, "workspaceSlug");
  const user = await requireWorkspacePermission(workspaceId, "team.create");
  await createTeam(
    {
      workspaceId,
      name: required(formData, "name"),
      description: optional(formData, "description"),
      memberUserIds: ids(formData, "memberUserIds"),
      memberAgentIds: ids(formData, "memberAgentIds"),
    },
    user.id
  );
  refresh(workspaceSlug, "teams");
}

export async function updateTeamMembersAction(formData: FormData) {
  const workspaceId = required(formData, "workspaceId");
  const workspaceSlug = required(formData, "workspaceSlug");
  const user = await requireWorkspacePermission(workspaceId, "team.update");
  await updateTeam(
    required(formData, "teamId"),
    {
      memberUserIds: ids(formData, "memberUserIds"),
      memberAgentIds: ids(formData, "memberAgentIds"),
    },
    user.id
  );
  refresh(workspaceSlug, "teams");
}

export async function createProjectAction(formData: FormData) {
  const workspaceId = optional(formData, "workspaceId");
  const workspaceSlug = optional(formData, "workspaceSlug");
  const user = workspaceId
    ? await requireWorkspacePermission(workspaceId, "project.create")
    : await import("@/lib/current-user").then(({ requireUser }) => requireUser());
  await createProject(
    {
      name: required(formData, "name"),
      description: optional(formData, "description"),
      workspaceId,
      teamId: optional(formData, "teamId"),
      tags: ids(formData, "tags"),
    },
    user.id
  );
  if (workspaceSlug) refresh(workspaceSlug, "projects");
  revalidatePath("/projects");
}

export async function createTaskAction(formData: FormData) {
  const workspaceId = required(formData, "workspaceId");
  const workspaceSlug = required(formData, "workspaceSlug");
  const user = await requireWorkspacePermission(workspaceId, "task.create");
  const status = (optional(formData, "status") as TaskStatus | undefined) ?? "backlog";
  const priority = (optional(formData, "priority") as TaskPriority | undefined) ?? "medium";
  assertOneOf(status, TASK_STATUSES, "status");
  assertOneOf(priority, TASK_PRIORITIES, "priority");
  const task = await db.task.create({
    data: {
      workspaceId,
      projectId: optional(formData, "projectId"),
      teamId: optional(formData, "teamId"),
      title: required(formData, "title"),
      description: optional(formData, "description"),
      status,
      priority,
      assignee: optional(formData, "assignee"),
      agentId: optional(formData, "agentId"),
      tags: ids(formData, "tags"),
    },
  });
  await writeAuditLog({ workspaceId, projectId: task.projectId, userId: user.id, action: "task.created", entityType: "task", entityId: task.id, details: { title: task.title, status: task.status } });
  refresh(workspaceSlug, "board");
}

export async function moveTaskAction(formData: FormData) {
  const workspaceId = required(formData, "workspaceId");
  const workspaceSlug = required(formData, "workspaceSlug");
  const user = await requireWorkspacePermission(workspaceId, "task.update");
  const taskId = required(formData, "taskId");
  const current = await db.task.findUniqueOrThrow({ where: { id: taskId } });
  const status = required(formData, "status") as TaskStatus;
  assertOneOf(status, TASK_STATUSES, "status");
  await db.task.update({ where: { id: taskId }, data: { status } });
  await writeAuditLog({ workspaceId, projectId: current.projectId, userId: user.id, action: "task.moved", entityType: "task", entityId: taskId, details: { previousStatus: current.status, status } });
  refresh(workspaceSlug, "board");
}

export async function createDocumentAction(formData: FormData) {
  const workspaceId = required(formData, "workspaceId");
  const workspaceSlug = required(formData, "workspaceSlug");
  const user = await requireWorkspacePermission(workspaceId, "document.create");
  const document = await db.document.create({
    data: {
      workspaceId,
      projectId: optional(formData, "projectId"),
      title: required(formData, "title"),
      type: optional(formData, "type") ?? "markdown",
      content: optional(formData, "content") ?? "",
      tags: ids(formData, "tags"),
    },
  });
  await writeAuditLog({ workspaceId, projectId: document.projectId, userId: user.id, action: "document.created", entityType: "document", entityId: document.id, details: { title: document.title, type: document.type } });
  refresh(workspaceSlug, "documents");
  revalidatePath("/files");
}

export async function createMeetingAction(formData: FormData) {
  const workspaceId = required(formData, "workspaceId");
  const workspaceSlug = required(formData, "workspaceSlug");
  const user = await requireWorkspacePermission(workspaceId, "meeting.create");
  await createMeeting(
    {
      workspaceId,
      projectId: optional(formData, "projectId"),
      title: required(formData, "title"),
      agenda: optional(formData, "agenda"),
      startsAt: new Date(required(formData, "startsAt")),
      endsAt: new Date(required(formData, "endsAt")),
      attendeeUserIds: ids(formData, "attendeeUserIds"),
      attendeeAgentIds: ids(formData, "attendeeAgentIds"),
    },
    user.id
  );
  refresh(workspaceSlug, "meetings");
}

export async function createPermissionAction(formData: FormData) {
  const workspaceId = required(formData, "workspaceId");
  const workspaceSlug = required(formData, "workspaceSlug");
  const user = await requireWorkspacePermission(workspaceId, "permission.manage");
  await createPermission(
    {
      workspaceId,
      key: required(formData, "key"),
      resource: required(formData, "resource"),
      action: required(formData, "permissionAction"),
      description: optional(formData, "description"),
    },
    user.id
  );
  refresh(workspaceSlug, "permissions");
}

export async function createRoleAction(formData: FormData) {
  const workspaceId = required(formData, "workspaceId");
  const workspaceSlug = required(formData, "workspaceSlug");
  const user = await requireWorkspacePermission(workspaceId, "permission.manage");
  await createRole(
    {
      workspaceId,
      name: required(formData, "name"),
      description: optional(formData, "description"),
      permissionIds: formData.getAll("permissionIds").map(String),
    },
    user.id
  );
  refresh(workspaceSlug, "permissions");
}

export async function assignRoleAction(formData: FormData) {
  const workspaceId = required(formData, "workspaceId");
  const workspaceSlug = required(formData, "workspaceSlug");
  const user = await requireWorkspacePermission(workspaceId, "permission.manage");
  const subjectType = required(formData, "subjectType");
  const subjectId = required(formData, "subjectId");
  const expiresAtInput = optional(formData, "expiresAt");
  await assignRole(
    {
      workspaceId,
      roleId: required(formData, "roleId"),
      ...(subjectType === "user" ? { userId: subjectId } : {}),
      ...(subjectType === "agent" ? { agentId: subjectId } : {}),
      ...(subjectType === "team" ? { teamId: subjectId } : {}),
      ...(expiresAtInput ? { expiresAt: new Date(expiresAtInput) } : {}),
    },
    user.id
  );
  refresh(workspaceSlug, "permissions");
}

export async function revokeAssignmentAction(formData: FormData) {
  const workspaceId = required(formData, "workspaceId");
  const workspaceSlug = required(formData, "workspaceSlug");
  const user = await requireWorkspacePermission(workspaceId, "permission.manage");
  await revokeRoleAssignment(required(formData, "assignmentId"), user.id);
  refresh(workspaceSlug, "permissions");
}

export async function createApprovalAction(formData: FormData) {
  const workspaceId = required(formData, "workspaceId");
  const workspaceSlug = required(formData, "workspaceSlug");
  const user = await requireWorkspacePermission(workspaceId, "approval.create");
  await createApproval(
    {
      workspaceId,
      projectId: optional(formData, "projectId"),
      title: required(formData, "title"),
      description: optional(formData, "description"),
      type: optional(formData, "type"),
    },
    user.id
  );
  refresh(workspaceSlug, "approvals");
}

export async function decideApprovalAction(formData: FormData) {
  const workspaceId = required(formData, "workspaceId");
  const workspaceSlug = required(formData, "workspaceSlug");
  const user = await requireWorkspacePermission(workspaceId, "approval.review");
  const status = required(formData, "status");
  if (status !== "approved" && status !== "rejected") throw new Error("Invalid approval status");
  await decideApproval(required(formData, "approvalId"), status, user.id, optional(formData, "decisionNote"));
  refresh(workspaceSlug, "approvals");
}
