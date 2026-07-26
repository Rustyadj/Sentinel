import { requireUser } from "@/lib/current-user";
import { adaptiveErrorResponse } from "@/lib/adaptive-memory/scope";
import { delegateTask, listAgentCapabilities } from "@/lib/adaptive-memory/delegation";
export async function GET(request: Request) {
  try { await requireUser(); const workspaceId = new URL(request.url).searchParams.get("workspaceId");
    if (!workspaceId) return Response.json({ error: "workspaceId is required" }, { status: 400 });
    return Response.json(await listAgentCapabilities(workspaceId)); }
  catch (error) { return adaptiveErrorResponse(error); }
}
export async function POST(request: Request) {
  try { const user = await requireUser(); return Response.json(await delegateTask({ ...(await request.json()), actingUserId: user.id }), { status: 201 }); }
  catch (error) { return adaptiveErrorResponse(error); }
}
