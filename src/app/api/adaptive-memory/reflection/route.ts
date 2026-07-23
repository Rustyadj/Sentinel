import { requireUser } from "@/lib/current-user";
import { adaptiveErrorResponse } from "@/lib/adaptive-memory/scope";
import { reflectExperience } from "@/lib/adaptive-memory/reflection";
export async function POST(request: Request) {
  try { const user = await requireUser(); return Response.json(await reflectExperience({ ...(await request.json()), actorUserId: user.id })); }
  catch (error) { return adaptiveErrorResponse(error); }
}
