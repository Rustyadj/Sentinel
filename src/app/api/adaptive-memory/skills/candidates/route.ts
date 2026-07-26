import { db } from "@/lib/db";
import { requireUser } from "@/lib/current-user";
import { adaptiveErrorResponse, requireAdaptiveScope } from "@/lib/adaptive-memory/scope";
import { createSkillCandidate } from "@/lib/adaptive-memory/skill-refinery";

export async function GET(request: Request) {
  try {
    const user = await requireUser(); const url = new URL(request.url);
    const workspaceId = url.searchParams.get("workspaceId") ?? undefined; const projectId = url.searchParams.get("projectId") ?? undefined;
    await requireAdaptiveScope({ actorUserId: user.id, workspaceId, projectId, permission: "knowledge.read" });
    return Response.json(await db.skillCandidate.findMany({ where: { workspaceId, projectId,
      ...(!workspaceId && !projectId ? { proposedBy: user.id } : {}),
      status: url.searchParams.get("status") ?? undefined }, include: { replayResults: true }, orderBy: { createdAt: "desc" }, take: 200 }));
  } catch (error) { return adaptiveErrorResponse(error); }
}
export async function POST(request: Request) {
  try { const user = await requireUser(); return Response.json(await createSkillCandidate(await request.json(), user.id), { status: 201 }); }
  catch (error) { return adaptiveErrorResponse(error); }
}
