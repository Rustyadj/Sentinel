import { requireUser } from "@/lib/current-user";
import { adaptiveErrorResponse } from "@/lib/adaptive-memory/scope";
import { searchEpisodes } from "@/lib/adaptive-memory/episodic-search";
export async function GET(request: Request) {
  try { const user = await requireUser(); const params = Object.fromEntries(new URL(request.url).searchParams);
    if (!params.query?.trim()) return Response.json({ error: "query is required" }, { status: 400 });
    return Response.json(await searchEpisodes({ query: params.query, actorUserId: user.id,
      organizationId: params.organizationId, workspaceId: params.workspaceId,
      projectId: params.projectId, limit: params.limit ? Number(params.limit) : undefined }));
  } catch (error) { return adaptiveErrorResponse(error); }
}
