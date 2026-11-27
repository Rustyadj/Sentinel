import { NextRequest, NextResponse } from "next/server";
import { requireWorkspacePermission } from "@/lib/workspaces/authorization";
import { computeAutonomyMetrics } from "@/lib/autonomy/metrics";
import { autonomyErrorResponse } from "../_shared";

export async function GET(request: NextRequest) {
  try {
    const workspaceId = request.nextUrl.searchParams.get("workspaceId");
    if (!workspaceId) return NextResponse.json({ error: "workspaceId is required" }, { status: 400 });
    await requireWorkspacePermission(workspaceId, "workspace.read");
    const days = Math.min(365, Math.max(1, Number(request.nextUrl.searchParams.get("days")) || 30));
    return NextResponse.json({ metrics: await computeAutonomyMetrics(workspaceId, days) });
  } catch (error) {
    return autonomyErrorResponse(error);
  }
}
