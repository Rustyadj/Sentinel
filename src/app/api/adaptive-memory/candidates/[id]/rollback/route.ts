import { requireUser } from "@/lib/current-user";
import { adaptiveErrorResponse } from "@/lib/adaptive-memory/scope";
import { rollbackMemoryCandidate } from "@/lib/adaptive-memory/memory-candidate-service";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireUser();
    const body = await request.json();
    if (!body.reason?.trim()) return Response.json({ error: "reason is required" }, { status: 400 });
    return Response.json(await rollbackMemoryCandidate((await params).id, user.id, body.reason));
  } catch (error) { return adaptiveErrorResponse(error); }
}
