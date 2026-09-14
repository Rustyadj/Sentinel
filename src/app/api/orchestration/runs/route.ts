import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getWorkspaceControlPlaneUser } from "@/lib/agents/permissions";

/** Admin-only operational view. Results intentionally exclude raw worker logs,
 * OAuth tokens, prompts, and retrieved memory content. */
export async function GET(request: NextRequest) {
  const workspaceId = request.nextUrl.searchParams.get("workspaceId");
  if (!workspaceId) return NextResponse.json({ error: "workspaceId is required" }, { status: 400 });
  const user = await getWorkspaceControlPlaneUser(workspaceId);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (user.role === "member") return NextResponse.json({ error: "Admin role required" }, { status: 403 });
  const limit = Math.min(Math.max(Number(request.nextUrl.searchParams.get("limit") ?? "50"), 1), 200);
  const runs = await db.orchestrationRun.findMany({
    where: { workspaceId },
    orderBy: { createdAt: "desc" },
    take: limit,
    select: {
      id: true, status: true, projectId: true, resolvedAgentId: true, requestedAgentId: true,
      routingDecision: true, validation: true, error: true, queuedAt: true, startedAt: true, completedAt: true,
      attempts: { select: { id: true, attemptNumber: true, agentId: true, adapterType: true, status: true, cost: true, latencyMs: true, error: true, createdAt: true } },
    },
  });
  return NextResponse.json({ runs });
}
