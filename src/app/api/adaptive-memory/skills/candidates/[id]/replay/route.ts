import { requireUser } from "@/lib/current-user";
import { adaptiveErrorResponse } from "@/lib/adaptive-memory/scope";
import { recordSkillReplay } from "@/lib/adaptive-memory/skill-refinery";
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try { const user = await requireUser(); return Response.json(await recordSkillReplay({ ...(await request.json()), candidateId: (await params).id, actorUserId: user.id }), { status: 201 }); }
  catch (error) { return adaptiveErrorResponse(error); }
}
