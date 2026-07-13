import { NextRequest, NextResponse } from "next/server";
import { deleteMeeting, updateMeeting } from "@/lib/workspaces";
import { accessErrorResponse, requireWorkspacePermission } from "@/lib/workspaces/authorization";
import { assertOneOf, MEETING_STATUSES } from "@/lib/workspaces/status";

type Context = { params: Promise<{ id: string; meetingId: string }> };

export async function PATCH(req: NextRequest, { params }: Context) {
  try {
    const { id, meetingId } = await params;
    const user = await requireWorkspacePermission(id, "meeting.update");
    const body = await req.json();
    assertOneOf(body.status, MEETING_STATUSES, "status");
    const meeting = await updateMeeting(
      meetingId,
      {
        ...(body.title !== undefined ? { title: body.title } : {}),
        ...(body.agenda !== undefined ? { agenda: body.agenda } : {}),
        ...(body.status !== undefined ? { status: body.status } : {}),
        ...(body.attendeeUserIds !== undefined ? { attendeeUserIds: body.attendeeUserIds } : {}),
        ...(body.attendeeAgentIds !== undefined ? { attendeeAgentIds: body.attendeeAgentIds } : {}),
        ...(body.startsAt ? { startsAt: new Date(body.startsAt) } : {}),
        ...(body.endsAt ? { endsAt: new Date(body.endsAt) } : {}),
      },
      user.id
    );
    return NextResponse.json(meeting);
  } catch (error) {
    return accessErrorResponse(error);
  }
}

export async function DELETE(_req: NextRequest, { params }: Context) {
  try {
    const { id, meetingId } = await params;
    const user = await requireWorkspacePermission(id, "meeting.delete");
    await deleteMeeting(meetingId, user.id);
    return new NextResponse(null, { status: 204 });
  } catch (error) {
    return accessErrorResponse(error);
  }
}
