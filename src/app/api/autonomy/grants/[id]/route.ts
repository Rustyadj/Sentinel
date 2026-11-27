import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireWorkspacePermission } from "@/lib/workspaces/authorization";
import { writeAuditLog } from "@/lib/workspaces/audit";
import { revokeGrant } from "@/lib/autonomy/authority-store";
import { autonomyErrorResponse, str } from "../../_shared";

/** Revoke a grant. Immediate: the next evaluation of any action rejects it. */
export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const grant = await db.authorityGrant.findUnique({ where: { id }, select: { workspaceId: true, revokedAt: true } });
    if (!grant) return NextResponse.json({ error: "Grant not found" }, { status: 404 });
    const user = await requireWorkspacePermission(grant.workspaceId, "approval.review");
    if (grant.revokedAt) return NextResponse.json({ revoked: true, alreadyRevoked: true });
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    const revoked = await revokeGrant({ grantId: id, workspaceId: grant.workspaceId, userId: user.id, reason: str(body?.reason, 500) ?? undefined });
    if (revoked) await writeAuditLog({ workspaceId: grant.workspaceId, userId: user.id, action: "autonomy.grant.revoked", entityType: "authority_grant", entityId: id, details: {} });
    return NextResponse.json({ revoked });
  } catch (error) {
    return autonomyErrorResponse(error);
  }
}
