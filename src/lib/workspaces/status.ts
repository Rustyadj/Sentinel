import { WorkspaceAccessError } from "./authorization";

export const TASK_STATUSES = ["backlog", "in-progress", "review", "done"] as const;
export type TaskStatus = (typeof TASK_STATUSES)[number];

export const TASK_PRIORITIES = ["low", "medium", "high", "urgent"] as const;
export type TaskPriority = (typeof TASK_PRIORITIES)[number];

export const MEETING_STATUSES = ["scheduled", "completed", "cancelled"] as const;
export type MeetingStatus = (typeof MEETING_STATUSES)[number];

export const APPROVAL_STATUSES = ["pending", "approved", "rejected"] as const;
export type ApprovalStatus = (typeof APPROVAL_STATUSES)[number];

export function assertOneOf<T extends string>(value: T | undefined, allowed: readonly T[], field: string): void {
  if (value === undefined) return;
  if (!allowed.includes(value)) {
    throw new WorkspaceAccessError(`Invalid ${field}: ${value}. Expected one of ${allowed.join(", ")}`, 400);
  }
}
