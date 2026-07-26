import { requireUser } from "@/lib/current-user";
import { adaptiveErrorResponse } from "@/lib/adaptive-memory/scope";
import { exportPackage } from "@/lib/adaptive-memory/portable-packages";
export async function GET(_request: Request, { params }: { params: Promise<{ kind: string; id: string }> }) {
  try { const user = await requireUser(); const { kind, id } = await params;
    return Response.json(await exportPackage(kind, id, user.id), { headers: { "content-disposition": `attachment; filename="sentinel-${kind}-${id}.json"` } }); }
  catch (error) { return adaptiveErrorResponse(error); }
}
