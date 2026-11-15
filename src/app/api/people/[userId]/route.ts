import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/current-user";
import { getOrgRole, removeOrgMember, setOrgMember } from "@/lib/people/organization";
import { canManagePeople, isInvitableOrgRole } from "@/lib/people/roles";
import { peopleErrorResponse } from "@/lib/people/http";

type Context = { params: Promise<{ userId: string }> };

async function requireManager() {
  const user = await requireUser();
  if (!canManagePeople(await getOrgRole(user.id))) {
    return { user, denied: NextResponse.json({ error: "Only owners and admins can change the team." }, { status: 403 }) };
  }
  return { user, denied: null };
}

export async function PATCH(req: NextRequest, { params }: Context) {
  try {
    const { user, denied } = await requireManager();
    if (denied) return denied;
    const { userId } = await params;
    const body = (await req.json().catch(() => null)) as { role?: unknown } | null;
    if (!isInvitableOrgRole(body?.role)) return NextResponse.json({ error: "Choose admin, operator or member." }, { status: 400 });
    if (userId === user.id) return NextResponse.json({ error: "You cannot change your own role." }, { status: 409 });
    // Only someone already on the team can be given a different role here;
    // anyone else joins by invitation, which they have to accept.
    if (!(await getOrgRole(userId))) return NextResponse.json({ error: "That person is not on the team." }, { status: 404 });
    await setOrgMember({ userId, role: body.role, actorId: user.id });
    return NextResponse.json({ ok: true });
  } catch (error) {
    return peopleErrorResponse(error);
  }
}

export async function DELETE(_req: NextRequest, { params }: Context) {
  try {
    const { user, denied } = await requireManager();
    if (denied) return denied;
    const { userId } = await params;
    if (userId === user.id) return NextResponse.json({ error: "You cannot remove yourself." }, { status: 409 });
    await removeOrgMember({ userId, actorId: user.id });
    return NextResponse.json({ ok: true });
  } catch (error) {
    return peopleErrorResponse(error);
  }
}
