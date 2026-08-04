import { listAuthorizedRuntimes } from "@/lib/agents/runtime/authorization";
import { publicRuntimeView, runtimeErrorResponse } from "@/lib/agents/runtime/api";

export async function GET() {
  try {
    const runtimes = await listAuthorizedRuntimes();
    return Response.json({ runtimes: runtimes.map(publicRuntimeView) });
  } catch (error) {
    return runtimeErrorResponse(error);
  }
}
