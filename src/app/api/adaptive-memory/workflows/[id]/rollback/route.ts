import { requireUser } from "@/lib/current-user";
import { adaptiveErrorResponse } from "@/lib/adaptive-memory/scope";
import { rollbackWorkflow } from "@/lib/adaptive-memory/workflow-discovery";

export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireUser();
    const { id } = await params;
    return Response.json(await rollbackWorkflow(id, user.id));
  } catch (error) { return adaptiveErrorResponse(error); }
}
