import { requireUser } from "@/lib/current-user";
import { adaptiveErrorResponse, requireAdaptiveScope } from "@/lib/adaptive-memory/scope";
import { workflowHealth } from "@/lib/adaptive-memory/workflow-discovery";
export async function GET(request: Request) {
  try { const user = await requireUser(); const workspaceId = new URL(request.url).searchParams.get("workspaceId");
    if (!workspaceId) return Response.json({ error: "workspaceId is required" }, { status: 400 });
    await requireAdaptiveScope({ actorUserId: user.id, workspaceId, permission: "workflow.read" });
    return Response.json(await workflowHealth(workspaceId));
  } catch (error) { return adaptiveErrorResponse(error); }
}
