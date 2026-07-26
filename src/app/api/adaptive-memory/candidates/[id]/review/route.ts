import { requireUser } from "@/lib/current-user";
import { adaptiveErrorResponse } from "@/lib/adaptive-memory/scope";
import { reviewMemoryCandidate } from "@/lib/adaptive-memory/memory-candidate-service";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireUser();
    const body = await request.json();
    if (body.decision !== "approve" && body.decision !== "reject") return Response.json({ error: "decision must be approve or reject" }, { status: 400 });
    return Response.json(await reviewMemoryCandidate((await params).id, body.decision, user.id, body.note));
  } catch (error) { return adaptiveErrorResponse(error); }
}
