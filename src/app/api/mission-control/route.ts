import { NextResponse } from "next/server";
import { requireUser } from "@/lib/current-user";
import { buildMissionControlData } from "@/lib/mission-control/server";
import { accessErrorResponse } from "@/lib/workspaces/authorization";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const user = await requireUser();
    return NextResponse.json(await buildMissionControlData(user), {
      headers: { "Cache-Control": "private, no-store, max-age=0" },
    });
  } catch (error) {
    return accessErrorResponse(error);
  }
}
