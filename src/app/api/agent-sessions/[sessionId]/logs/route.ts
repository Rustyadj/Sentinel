import { RUNTIME_PERMISSIONS, requireSessionAccess } from "@/lib/agents/runtime/authorization";
import { parseLimit, runtimeErrorResponse } from "@/lib/agents/runtime/api";
import { getRuntimeAdapter } from "@/lib/agents/runtime/service";

export async function GET(request: Request, { params }: { params: Promise<{ sessionId: string }> }) {
  try {
    const { sessionId } = await params;
    const { runtime } = await requireSessionAccess(sessionId, RUNTIME_PERMISSIONS.viewLogs);
    const url = new URL(request.url);
    const logs = await getRuntimeAdapter(runtime.kind).getLogs({ sessionId, since: url.searchParams.get("since") ?? undefined, limit: parseLimit(url.searchParams.get("limit"), 200, 500) });
    return Response.json(logs);
  } catch (error) { return runtimeErrorResponse(error); }
}
