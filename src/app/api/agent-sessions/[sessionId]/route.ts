import { RUNTIME_PERMISSIONS, requireSessionAccess } from "@/lib/agents/runtime/authorization";
import { runtimeErrorResponse } from "@/lib/agents/runtime/api";
import { getRuntimeAdapter } from "@/lib/agents/runtime/service";

export async function GET(_request: Request, { params }: { params: Promise<{ sessionId: string }> }) {
  try {
    const { sessionId } = await params;
    const { runtime } = await requireSessionAccess(sessionId, RUNTIME_PERMISSIONS.view);
    const session = await getRuntimeAdapter(runtime.kind).getSession(sessionId);
    return session ? Response.json({ session }) : Response.json({ error: "Session not found" }, { status: 404 });
  } catch (error) { return runtimeErrorResponse(error); }
}
