import { requireUser } from "@/lib/current-user";
import { adaptiveErrorResponse } from "@/lib/adaptive-memory/scope";
import { consolidateScope } from "@/lib/adaptive-memory/consolidation";
export async function POST(request: Request) {
  try { const user = await requireUser(); return Response.json(await consolidateScope({ ...(await request.json()), actorUserId: user.id })); }
  catch (error) { return adaptiveErrorResponse(error); }
}
