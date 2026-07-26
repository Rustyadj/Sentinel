import { db } from "@/lib/db";
import { requireUser } from "@/lib/current-user";
import { adaptiveErrorResponse, requireAdaptiveScope } from "@/lib/adaptive-memory/scope";
import { writeAuditLog } from "@/lib/workspaces/audit";
export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try { const user = await requireUser(); const client = await db.mcpClient.findUniqueOrThrow({ where: { id: (await params).id } });
    if (client.workspaceId) await requireAdaptiveScope({ actorUserId: user.id, workspaceId: client.workspaceId, projectId: client.projectId, permission: "mcp.manage" });
    else if (client.createdBy !== user.id) throw new Error("MCP client access denied.");
    const revoked = await db.mcpClient.update({ where: { id: client.id }, data: { revokedAt: new Date() } });
    await writeAuditLog({ workspaceId: client.workspaceId, projectId: client.projectId, userId: user.id,
      action: "mcp.client_revoked", entityType: "mcpClient", entityId: client.id });
    return Response.json({ id: revoked.id, revokedAt: revoked.revokedAt });
  } catch (error) { return adaptiveErrorResponse(error); }
}
