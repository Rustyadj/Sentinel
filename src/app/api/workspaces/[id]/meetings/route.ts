import { NextRequest, NextResponse } from "next/server";
import { createMeeting, listMeetings } from "@/lib/workspaces";
import { accessErrorResponse, requireWorkspacePermission } from "@/lib/workspaces/authorization";

type Context = { params: Promise<{ id: string }> };

export async function GET(_req: NextRequest, { params }: Context) {
  try {
    const { id } = await params;
    await requireWorkspacePermission(id, "meeting.read");
    return NextResponse.json({ meetings: await listMeetings(id) });
  } catch (error) {
    return accessErrorResponse(error);
  }
}

export async function POST(req: NextRequest, { params }: Context) {
  try {
    const { id } = await params;
    const user = await requireWorkspacePermission(id, "meeting.create");
    const body = await req.json();
    if (!body.title || !body.startsAt || !body.endsAt) {
      return NextResponse.json({ error: "Missing required fields: title, startsAt, endsAt" }, { status: 400 });
    }
    const meeting = await createMeeting(
      { ...body, workspaceId: id, startsAt: new Date(body.startsAt), endsAt: new Date(body.endsAt) },
      user.id
    );
    return NextResponse.json(meeting, { status: 201 });
  } catch (error) {
    return accessErrorResponse(error);
  }
}
