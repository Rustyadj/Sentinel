import { db } from "@/lib/db";
import { requireUser } from "@/lib/current-user";
import { adaptiveErrorResponse, requireAdaptiveScope } from "@/lib/adaptive-memory/scope";
import { ingestSource } from "@/lib/adaptive-memory/ingestion";

export async function GET(request: Request) {
  try {
    const user = await requireUser();
    const url = new URL(request.url);
    const workspaceId = url.searchParams.get("workspaceId") ?? undefined;
    const projectId = url.searchParams.get("projectId") ?? undefined;
    await requireAdaptiveScope({ actorUserId: user.id, workspaceId, projectId, permission: "knowledge.read" });
    return Response.json(await db.sourceDocument.findMany({ where: workspaceId || projectId ? { workspaceId, projectId } : { userId: user.id },
      select: { id: true, sourceSystem: true, sourceId: true, sourceUri: true, title: true, originalAuthor: true,
        retrievedAt: true, checksum: true, version: true, sensitivity: true, status: true, createdAt: true },
      orderBy: { updatedAt: "desc" }, take: 200 }));
  } catch (error) { return adaptiveErrorResponse(error); }
}

export async function POST(request: Request) {
  try { const user = await requireUser(); return Response.json(await ingestSource({ ...(await request.json()), actorUserId: user.id }), { status: 201 }); }
  catch (error) { return adaptiveErrorResponse(error); }
}
