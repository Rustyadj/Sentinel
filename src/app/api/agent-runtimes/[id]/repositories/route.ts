import { RUNTIME_PERMISSIONS, requireRuntimeAccess } from "@/lib/agents/runtime/authorization";
import { runtimeErrorResponse } from "@/lib/agents/runtime/api";
import { asRuntimeInstance } from "@/lib/agents/runtime/config";
import { listRuntimeRepositories } from "@/lib/agents/runtime/repositories";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const { runtime } = await requireRuntimeAccess(id, RUNTIME_PERMISSIONS.view);
    return Response.json({ repositories: await listRuntimeRepositories(asRuntimeInstance(runtime)) });
  } catch (error) { return runtimeErrorResponse(error); }
}
