import { db } from "@/lib/db";
import { requireUser } from "@/lib/current-user";
import { adaptiveErrorResponse, requireAdaptiveScope } from "@/lib/adaptive-memory/scope";
import { discoverWorkflowProposals } from "@/lib/adaptive-memory/workflow-discovery";
export async function GET(request: Request) {
  try { const user = await requireUser(); const url = new URL(request.url);
    const workspaceId = url.searchParams.get("workspaceId") ?? undefined; const projectId = url.searchParams.get("projectId") ?? undefined;
    await requireAdaptiveScope({ actorUserId: user.id, workspaceId, projectId, permission: "workflow.read" });
    return Response.json(await db.workflowProposal.findMany({ where: { workspaceId, projectId,
      ...(!workspaceId && !projectId ? { ownerUserId: user.id } : {}) }, orderBy: { createdAt: "desc" }, take: 200 }));
  } catch (error) { return adaptiveErrorResponse(error); }
}
export async function POST(request: Request) {
  try { const user = await requireUser(); return Response.json(await discoverWorkflowProposals({ ...(await request.json()), actorUserId: user.id })); }
  catch (error) { return adaptiveErrorResponse(error); }
}
