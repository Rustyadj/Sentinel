import { RUNTIME_PERMISSIONS, requireRuntimeAccess } from "@/lib/agents/runtime/authorization";
import { publicRuntimeView, runtimeErrorResponse } from "@/lib/agents/runtime/api";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const { runtime } = await requireRuntimeAccess(id, RUNTIME_PERMISSIONS.view);
    return Response.json({ runtime: publicRuntimeView(runtime) });
  } catch (error) {
    return runtimeErrorResponse(error);
  }
}
