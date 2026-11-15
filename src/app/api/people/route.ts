import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/current-user";
import { getOrgRole, listOrgMembers } from "@/lib/people/organization";
import { listInvitations } from "@/lib/people/invitations";
import { canManagePeople } from "@/lib/people/roles";
import { peopleErrorResponse } from "@/lib/people/http";
import { userHasWorkspacePermission } from "@/lib/workspaces/authorization";

/** Whether this person can make any agent do anything. Decides which composer they get. */
async function canRunAgents(userId: string): Promise<boolean> {
  const runtimes = await db.agentRuntime.findMany({ where: { workspaceId: { not: null } }, select: { workspaceId: true }, distinct: ["workspaceId"] });
  for (const { workspaceId } of runtimes) {
    if (workspaceId && (await userHasWorkspacePermission(userId, workspaceId, "agents.runtime.execute"))) return true;
  }
  return false;
}

export async function GET() {
  try {
    const user = await requireUser();
    const role = await getOrgRole(user.id);
    const me = {
      id: user.id, name: user.name, email: user.email, role,
      guest: user.accessScope === "guest", canManage: canManagePeople(role), canRunAgents: await canRunAgents(user.id),
    };
    // The roster is for the team. A project guest learns who is on their
    // project from the project itself, not who else works here.
    if (!role) return NextResponse.json({ me, organization: null, members: [], invitations: await listInvitations(user.id) });

    const { organization, members } = await listOrgMembers();
    return NextResponse.json({
      me,
      organization,
      members: members.map((m) => ({
        userId: m.user.id, name: m.user.name, role: m.role, joinedAt: m.createdAt,
        // Addresses are for whoever manages the roster.
        email: me.canManage || m.user.id === user.id ? m.user.email : null,
      })),
      invitations: await listInvitations(user.id),
    });
  } catch (error) {
    return peopleErrorResponse(error);
  }
}
