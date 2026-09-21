import { NextResponse } from "next/server";
import { requireUser } from "@/lib/current-user";
import { loadControlPlane } from "@/lib/control-plane/service";
import { accessErrorResponse } from "@/lib/workspaces/authorization";

// Every value here is an observation with a timestamp; a cached copy would be
// presented with the freshness of the original and is therefore worse than no
// answer at all.
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    await requireUser();
    return NextResponse.json(await loadControlPlane(), {
      headers: { "Cache-Control": "private, no-store, max-age=0" },
    });
  } catch (error) {
    return accessErrorResponse(error);
  }
}
