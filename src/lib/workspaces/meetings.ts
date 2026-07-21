import { db } from "@/lib/db";
import { writeAuditLog } from "./audit";
import type { MeetingStatus } from "./status";

export function listMeetings(workspaceId: string) {
  return db.meeting.findMany({
    where: { workspaceId },
    include: { project: { select: { id: true, name: true } }, createdBy: { select: { id: true, name: true, email: true } } },
    orderBy: { startsAt: "asc" },
  });
}

export async function createMeeting(input: { workspaceId: string; projectId?: string; title: string; agenda?: string; startsAt: Date; endsAt: Date; attendeeUserIds?: string[]; attendeeAgentIds?: string[] }, userId: string) {
  if (input.endsAt <= input.startsAt) throw new Error("Meeting end must be after start");
  const meeting = await db.meeting.create({
    data: { ...input, createdById: userId, attendeeUserIds: input.attendeeUserIds ?? [], attendeeAgentIds: input.attendeeAgentIds ?? [] },
  });
  await writeAuditLog({ workspaceId: input.workspaceId, projectId: input.projectId, userId, action: "meeting.created", entityType: "meeting", entityId: meeting.id, details: { title: meeting.title, startsAt: meeting.startsAt.toISOString() } });
  return meeting;
}

export async function updateMeeting(id: string, data: { title?: string; agenda?: string | null; startsAt?: Date; endsAt?: Date; status?: MeetingStatus; attendeeUserIds?: string[]; attendeeAgentIds?: string[] }, userId: string) {
  const meeting = await db.meeting.update({ where: { id }, data });
  await writeAuditLog({ workspaceId: meeting.workspaceId, projectId: meeting.projectId, userId, action: "meeting.updated", entityType: "meeting", entityId: id, details: { status: meeting.status } });
  return meeting;
}

export async function deleteMeeting(id: string, userId: string) {
  const meeting = await db.meeting.findUniqueOrThrow({ where: { id } });
  await writeAuditLog({ workspaceId: meeting.workspaceId, projectId: meeting.projectId, userId, action: "meeting.deleted", entityType: "meeting", entityId: id });
  return db.meeting.delete({ where: { id } });
}
