import { requireUser } from "@/lib/current-user";
import { adaptiveErrorResponse } from "@/lib/adaptive-memory/scope";
import { retrieveAdaptiveContext } from "@/lib/adaptive-memory/retrieval";

export async function POST(request: Request) {
  try {
    const user = await requireUser();
    const body = await request.json();
    if (!body.query?.trim()) return Response.json({ error: "query is required" }, { status: 400 });
    return Response.json(await retrieveAdaptiveContext({ ...body, userId: user.id }));
  } catch (error) { return adaptiveErrorResponse(error); }
}
