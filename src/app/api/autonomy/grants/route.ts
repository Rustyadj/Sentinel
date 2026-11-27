import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireWorkspacePermission } from "@/lib/workspaces/authorization";
import { writeAuditLog } from "@/lib/workspaces/audit";
import { isConsequential } from "@/lib/autonomy/authority";
import { createGrant } from "@/lib/autonomy/authority-store";
import { autonomyErrorResponse, dateOrNull, intOrNull, str, strList } from "../_shared";

/** Standing delegation grants for one workspace, with recent uses. */
export async function GET(request: NextRequest) {
  try {
    const workspaceId = request.nextUrl.searchParams.get("workspaceId");
    if (!workspaceId) return NextResponse.json({ error: "workspaceId is required" }, { status: 400 });
    await requireWorkspacePermission(workspaceId, "approval.read");
    const includeRevoked = request.nextUrl.searchParams.get("includeRevoked") === "1";
    const grants = await db.authorityGrant.findMany({
      where: { workspaceId, ...(includeRevoked ? {} : { revokedAt: null }) },
      orderBy: { createdAt: "desc" },
      take: 200,
      include: { uses: { orderBy: { createdAt: "desc" }, take: 10 } },
    });
    return NextResponse.json({ grants });
  } catch (error) {
    return autonomyErrorResponse(error);
  }
}

/**
 * Delegate authority once. Whoever can review approvals can pre-approve
 * routine operations; consequential operations (external, deploy, publish,
 * financial, legal, destructive, credential) additionally need
 * permission.manage, because they delegate the most sensitive decisions.
 */
export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as Record<string, unknown> | null;
    if (!body || typeof body !== "object") return NextResponse.json({ error: "Body must be an object" }, { status: 400 });
    const workspaceId = str(body.workspaceId, 64);
    if (!workspaceId) return NextResponse.json({ error: "workspaceId is required" }, { status: 400 });
    const user = await requireWorkspacePermission(workspaceId, "approval.review");
    const operations = strList(body.operations, 16);
    if (operations.some(isConsequential)) await requireWorkspacePermission(workspaceId, "permission.manage");

    const projectId = str(body.projectId, 64);
    if (projectId) {
      const project = await db.project.findFirst({ where: { id: projectId, workspaceId }, select: { id: true } });
      if (!project) return NextResponse.json({ error: "projectId is not in this workspace" }, { status: 400 });
    }
    const objectiveId = str(body.objectiveId, 64);
    if (objectiveId) {
      const objective = await db.objective.findFirst({ where: { id: objectiveId, workspaceId }, select: { id: true } });
      if (!objective) return NextResponse.json({ error: "objectiveId is not in this workspace" }, { status: 400 });
    }

    const grant = await createGrant({
      workspaceId, grantedByUserId: user.id, operations, projectId, objectiveId,
      agentId: str(body.agentId, 80), roomId: str(body.roomId, 64),
      capabilities: strList(body.capabilities), runtimes: strList(body.runtimes, 8),
      maxUses: intOrNull(body.maxUses), budgetCents: intOrNull(body.budgetCents),
      period: str(body.period, 8), periodMaxUses: intOrNull(body.periodMaxUses),
      startsAt: dateOrNull(body.startsAt), expiresAt: dateOrNull(body.expiresAt),
      reason: str(body.reason, 500) ?? "",
    });
    await writeAuditLog({ workspaceId, userId: user.id, action: "autonomy.grant.created", entityType: "authority_grant", entityId: grant.id, details: { operations: grant.operations, agentId: grant.agentId, projectId: grant.projectId, budgetCents: grant.budgetCents, expiresAt: grant.expiresAt?.toISOString() ?? null } });
    return NextResponse.json({ grant }, { status: 201 });
  } catch (error) {
    return autonomyErrorResponse(error);
  }
}
