import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/current-user";
import { createInvitation, listInvitations } from "@/lib/people/invitations";
import { invitationUrl, peopleErrorResponse } from "@/lib/people/http";

export async function GET() {
  try {
    const user = await requireUser();
    return NextResponse.json({ invitations: await listInvitations(user.id) });
  } catch (error) {
    return peopleErrorResponse(error);
  }
}

export async function POST(req: NextRequest) {
  try {
    const user = await requireUser();
    const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
    if (!body || (body.scope !== "organization" && body.scope !== "project") || typeof body.role !== "string") {
      return NextResponse.json({ error: "scope and role are required" }, { status: 400 });
    }
    const { invitation, token } = await createInvitation({
      scope: body.scope,
      role: body.role,
      projectId: typeof body.projectId === "string" ? body.projectId : undefined,
      email: typeof body.email === "string" ? body.email : null,
      note: typeof body.note === "string" ? body.note : null,
      expiresInDays: typeof body.expiresInDays === "number" ? body.expiresInDays : undefined,
    }, user.id);
    // The link is shown once. Only its hash is kept, so it cannot be shown again.
    return NextResponse.json({ id: invitation.id, url: invitationUrl(req, token), expiresAt: invitation.expiresAt }, { status: 201 });
  } catch (error) {
    return peopleErrorResponse(error);
  }
}
