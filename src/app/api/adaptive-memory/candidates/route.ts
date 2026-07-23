import { requireUser } from "@/lib/current-user";
import { adaptiveErrorResponse, requireAdaptiveScope } from "@/lib/adaptive-memory/scope";
import { listMemoryCandidates, proposeMemoryCandidate } from "@/lib/adaptive-memory/memory-candidate-service";

export async function GET(request: Request) {
  try {
    const user = await requireUser();
    const url = new URL(request.url);
    const workspaceId = url.searchParams.get("workspaceId") ?? undefined;
    const projectId = url.searchParams.get("projectId") ?? undefined;
    await requireAdaptiveScope({ actorUserId: user.id, workspaceId, projectId, permission: "knowledge.read" });
    return Response.json(await listMemoryCandidates({ workspaceId, projectId,
      userId: workspaceId || projectId ? undefined : user.id, status: url.searchParams.get("status") ?? undefined }));
  } catch (error) { return adaptiveErrorResponse(error); }
}

export async function POST(request: Request) {
  try {
    const user = await requireUser();
    return Response.json(await proposeMemoryCandidate(await request.json(), user.id), { status: 201 });
  } catch (error) { return adaptiveErrorResponse(error); }
}
