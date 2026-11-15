import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireProjectPermission } from "@/lib/workspaces/authorization";
import { listProjectMembers, userCanShareProject } from "@/lib/people/project-access";
import { isProjectRole } from "@/lib/people/roles";
import { peopleErrorResponse } from "@/lib/people/http";
import { writeAuditLog } from "@/lib/workspaces/audit";

type Context = { params: Promise<{ id: string }> };

export async function GET(_req: NextRequest, { params }: Context) {
  try {
    const { id } = await params;
    const { user, project } = await requireProjectPermission(id, "project.read");
    const canShare = await userCanShareProject(user.id, project);
    const { owner, members } = await listProjectMembers(id);
    // Names for everyone on the project; addresses only for whoever manages it.
    const person = (p: { id: string; name: string | null; email: string }) => ({
      id: p.id, name: p.name ?? (canShare ? p.email : "Member"), email: canShare || p.id === user.id ? p.email : null,
    });
    return NextResponse.json({
      canShare,
      owner: person(owner),
      members: members.map((m) => ({ id: m.id, role: m.role, user: person(m.user), createdAt: m.createdAt })),
    });
  } catch (error) {
    return peopleErrorResponse(error);
  }
}

async function requireSharer(projectId: string) {
  const { user, project } = await requireProjectPermission(projectId, "project.read");
  if (!(await userCanShareProject(user.id, project))) {
    return { user, denied: NextResponse.json({ error: "Only the project owner or a team admin can change who is on this project." }, { status: 403 }) };
  }
  return { user, denied: null };
}

export async function PATCH(req: NextRequest, { params }: Context) {
  try {
    const { id } = await params;
    const { user, denied } = await requireSharer(id);
    if (denied) return denied;
    const body = (await req.json().catch(() => null)) as { memberId?: unknown; role?: unknown } | null;
    if (typeof body?.memberId !== "string" || !isProjectRole(body.role)) {
      return NextResponse.json({ error: "memberId and a role of editor or viewer are required" }, { status: 400 });
    }
    const changed = await db.projectMember.updateMany({ where: { id: body.memberId, projectId: id }, data: { role: body.role } });
    if (!changed.count) return NextResponse.json({ error: "That person is not on this project." }, { status: 404 });
    await writeAuditLog({ userId: user.id, projectId: id, action: "project.member_role_changed", entityType: "projectMember", entityId: body.memberId, details: { role: body.role } });
    return NextResponse.json({ ok: true });
  } catch (error) {
    return peopleErrorResponse(error);
  }
}

export async function DELETE(req: NextRequest, { params }: Context) {
  try {
    const { id } = await params;
    const { user, denied } = await requireSharer(id);
    if (denied) return denied;
    const memberId = req.nextUrl.searchParams.get("memberId");
    if (!memberId) return NextResponse.json({ error: "memberId is required" }, { status: 400 });
    const removed = await db.projectMember.deleteMany({ where: { id: memberId, projectId: id } });
    if (!removed.count) return NextResponse.json({ error: "That person is not on this project." }, { status: 404 });
    await writeAuditLog({ userId: user.id, projectId: id, action: "project.member_removed", entityType: "projectMember", entityId: memberId });
    return NextResponse.json({ ok: true });
  } catch (error) {
    return peopleErrorResponse(error);
  }
}
