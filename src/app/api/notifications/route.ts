import { NextResponse } from "next/server";
import { requireUser } from "@/lib/current-user";
import { getAccessibleWorkspaceIds } from "@/lib/agents/permissions";
import { db } from "@/lib/db";

// There is no dedicated Notification model — the top bar surfaces real
// recent AuditLog entries across the user's accessible workspaces instead
// of inventing a read/unread system with nothing real behind it.
export async function GET() {
  const user = await requireUser().catch(() => null);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const workspaceIds = await getAccessibleWorkspaceIds(user.id);
  if (workspaceIds.length === 0) return NextResponse.json({ notifications: [] });

  const entries = await db.auditLog.findMany({
    where: { workspaceId: { in: workspaceIds } },
    orderBy: { createdAt: "desc" },
    take: 20,
    select: {
      id: true,
      action: true,
      entityType: true,
      entityId: true,
      actorType: true,
      createdAt: true,
      workspace: { select: { name: true } },
      user: { select: { name: true, email: true } },
    },
  });

  return NextResponse.json({
    notifications: entries.map((entry) => ({
      id: entry.id,
      action: entry.action,
      entityType: entry.entityType,
      entityId: entry.entityId,
      actorType: entry.actorType,
      actorName: entry.user?.name ?? entry.user?.email ?? null,
      workspaceName: entry.workspace?.name ?? null,
      createdAt: entry.createdAt.toISOString(),
    })),
  });
}
