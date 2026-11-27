import { getWorkforceSnapshot } from "@/lib/workforce/snapshot";
import { WorkspaceAccessError } from "@/lib/workspaces/authorization";

export async function GET(request: Request) {
  const workspaceId = new URL(request.url).searchParams.get("workspaceId");
  if (!workspaceId || workspaceId.length > 100) return Response.json({ error: "A workspace is required." }, { status: 400 });
  try {
    return Response.json(await getWorkforceSnapshot(workspaceId), { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof WorkspaceAccessError) return Response.json({ error: error.message }, { status: error.status });
    throw error;
  }
}
