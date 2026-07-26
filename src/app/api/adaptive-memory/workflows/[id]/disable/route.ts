import { requireUser } from "@/lib/current-user";
import { adaptiveErrorResponse } from "@/lib/adaptive-memory/scope";
import { disableWorkflow } from "@/lib/adaptive-memory/workflow-discovery";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireUser();
    const { id } = await params;
    const body = await request.json().catch(() => ({}));
    return Response.json(await disableWorkflow(id, user.id, typeof body.reason === "string" ? body.reason : undefined));
  } catch (error) { return adaptiveErrorResponse(error); }
}
