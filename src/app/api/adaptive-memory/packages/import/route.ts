import { requireUser } from "@/lib/current-user";
import { adaptiveErrorResponse } from "@/lib/adaptive-memory/scope";
import { importPackage } from "@/lib/adaptive-memory/portable-packages";
export async function POST(request: Request) {
  try { const user = await requireUser(); return Response.json(await importPackage({ ...(await request.json()), actorUserId: user.id }), { status: 201 }); }
  catch (error) { return adaptiveErrorResponse(error); }
}
