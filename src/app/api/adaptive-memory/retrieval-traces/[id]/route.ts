import { requireUser } from "@/lib/current-user";
import { adaptiveErrorResponse, requireAdaptiveScope } from "@/lib/adaptive-memory/scope";
import { getRetrievalTrace } from "@/lib/adaptive-memory/retrieval";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireUser();
    const trace = await getRetrievalTrace((await params).id);
    if (!trace) return Response.json({ error: "Trace not found" }, { status: 404 });
    await requireAdaptiveScope({ actorUserId: user.id, workspaceId: trace.workspaceId,
      projectId: trace.projectId, userId: trace.userId, permission: "knowledge.read" });
    return Response.json(trace);
  } catch (error) { return adaptiveErrorResponse(error); }
}
