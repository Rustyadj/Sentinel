import { db } from "@/lib/db";
import { requireUser } from "@/lib/current-user";
import { adaptiveErrorResponse, requireAdaptiveScope } from "@/lib/adaptive-memory/scope";
import { createMcpClient } from "@/lib/mcp/auth";

export async function GET(request: Request) {
  try { const user = await requireUser(); const workspaceId = new URL(request.url).searchParams.get("workspaceId") ?? undefined;
    if (workspaceId) await requireAdaptiveScope({ actorUserId: user.id, workspaceId, permission: "mcp.manage" });
    return Response.json(await db.mcpClient.findMany({ where: workspaceId ? { workspaceId } : { createdBy: user.id },
      select: { id: true, name: true, credentialPrefix: true, organizationId: true, workspaceId: true,
        projectId: true, userId: true, scopes: true, allowedOrigins: true, trustLevel: true,
        rateLimitPerMinute: true, maxCostPerRequest: true, expiresAt: true, lastSeenAt: true, revokedAt: true, createdAt: true },
      orderBy: { createdAt: "desc" } }));
  } catch (error) { return adaptiveErrorResponse(error); }
}
export async function POST(request: Request) {
  try { const user = await requireUser(); const body = await request.json();
    if (body.workspaceId) await requireAdaptiveScope({ actorUserId: user.id, workspaceId: body.workspaceId, projectId: body.projectId, permission: "mcp.manage" });
    const created = await createMcpClient({ ...body, userId: user.id, createdBy: user.id, expiresAt: new Date(body.expiresAt) });
    return Response.json(created, { status: 201 });
  } catch (error) { return adaptiveErrorResponse(error); }
}
