// Real, database-backed data for the four LensOverview supporting panels
// (Lens Status / Active Runs / Alerts / Recent Changes — see
// components/neural-lens/LensOverview.tsx). Every lens draws from the same
// workspace-scoped tables the rest of the workspace apps already use — no
// per-lens fake entities, no decorative counters.

import { db } from "@/lib/db";
import { getWorkspaceBySlug } from "./objects";

export interface LensStatusItem {
  label: string;
  value: string | number;
}

export interface LensActiveRun {
  id: string;
  label: string;
  detail: string;
}

export interface LensAlert {
  id: string;
  label: string;
  detail: string;
  severity: "critical" | "warning";
}

export interface LensRecentChange {
  id: string;
  label: string;
  detail: string;
  at: Date;
}

export interface LensOverviewStats {
  workspaceId: string;
  workspaceName: string;
  accent: string;
  statusItems: LensStatusItem[];
  activeRuns: LensActiveRun[];
  alerts: LensAlert[];
  recentChanges: LensRecentChange[];
}

const AUDIT_ACTION_LABEL: Record<string, string> = {
  "workspace.created": "Workspace created",
  "workspace.updated": "Workspace updated",
  "project.created": "Project created",
  "task.created": "Task created",
  "task.moved": "Task moved",
  "document.created": "Document created",
  "meeting.created": "Meeting scheduled",
  "team.created": "Team created",
  "team.members_updated": "Team members updated",
  "approval.created": "Approval requested",
  "approval.decided": "Approval decided",
  "role.created": "Role created",
  "role.assigned": "Role assigned",
  "role.assignment_revoked": "Role assignment revoked",
  "permission.created": "Permission added",
};

/** Fetches the four LensOverview supporting panels for one workspace slug.
 * Returns null if the workspace doesn't exist (caller renders empty state). */
export async function getLensOverviewStats(slug: string): Promise<LensOverviewStats | null> {
  const workspace = await getWorkspaceBySlug(slug);
  if (!workspace) return null;

  const [projectCount, taskCount, documentCount, upcomingMeetings, activeTasks, overdueTasks, pendingApprovals, recentAudit] =
    await Promise.all([
      db.project.count({ where: { workspaceId: workspace.id } }),
      db.task.count({ where: { workspaceId: workspace.id } }),
      db.document.count({ where: { workspaceId: workspace.id } }),
      db.meeting.count({ where: { workspaceId: workspace.id, startsAt: { gte: new Date() } } }),
      db.task.findMany({
        where: { workspaceId: workspace.id, status: "in-progress" },
        orderBy: { updatedAt: "desc" },
        take: 5,
        select: { id: true, title: true, assignee: true, updatedAt: true },
      }),
      db.task.findMany({
        where: { workspaceId: workspace.id, status: { not: "done" }, dueDate: { lt: new Date() } },
        orderBy: { dueDate: "asc" },
        take: 5,
        select: { id: true, title: true, dueDate: true },
      }),
      db.approvalRequest.findMany({
        where: { workspaceId: workspace.id, status: "pending" },
        orderBy: { createdAt: "asc" },
        take: 5,
        select: { id: true, title: true, createdAt: true },
      }),
      db.auditLog.findMany({
        where: { workspaceId: workspace.id },
        orderBy: { createdAt: "desc" },
        take: 8,
        select: { id: true, action: true, entityType: true, createdAt: true, details: true },
      }),
    ]);

  const statusItems: LensStatusItem[] = [
    { label: "Projects", value: projectCount },
    { label: "Tasks", value: taskCount },
    { label: "Documents", value: documentCount },
    { label: "Upcoming meetings", value: upcomingMeetings },
  ];

  const activeRuns: LensActiveRun[] = activeTasks.map((task) => ({
    id: task.id,
    label: task.title,
    detail: task.assignee ? `In progress · ${task.assignee}` : "In progress",
  }));

  const alerts: LensAlert[] = [
    ...overdueTasks.map((task) => ({
      id: `task:${task.id}`,
      label: task.title,
      detail: task.dueDate ? `Overdue since ${task.dueDate.toLocaleDateString()}` : "Overdue",
      severity: "critical" as const,
    })),
    ...pendingApprovals.map((approval) => ({
      id: `approval:${approval.id}`,
      label: approval.title,
      detail: "Awaiting approval",
      severity: "warning" as const,
    })),
  ].slice(0, 6);

  const recentChanges: LensRecentChange[] = recentAudit.map((entry) => ({
    id: entry.id,
    label: AUDIT_ACTION_LABEL[entry.action] ?? entry.action,
    detail: entry.entityType ?? "",
    at: entry.createdAt,
  }));

  return {
    workspaceId: workspace.id,
    workspaceName: workspace.name,
    accent: workspace.color,
    statusItems,
    activeRuns,
    alerts,
    recentChanges,
  };
}
