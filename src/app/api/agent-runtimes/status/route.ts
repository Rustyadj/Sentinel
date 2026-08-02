import { listAuthorizedRuntimes } from "@/lib/agents/runtime/authorization";
import { runtimeErrorResponse } from "@/lib/agents/runtime/api";
import { listRuntimeOperationalStatuses } from "@/lib/agents/runtime/status";

export async function GET() {
  try {
    const runtimes = await listAuthorizedRuntimes();
    const statuses = await listRuntimeOperationalStatuses(runtimes);
    return Response.json({ statuses, generatedAt: new Date().toISOString() });
  } catch (error) {
    return runtimeErrorResponse(error);
  }
}
