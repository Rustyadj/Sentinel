import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireUser } from "@/lib/current-user";
import { accessErrorResponse } from "@/lib/workspaces/authorization";
import { db } from "@/lib/db";
import { ingestOperationalEvent, requireOperationalAccess } from "@/lib/knowledge/operational-ingestion";
import { operationalGraph, operationalHistory, proposeDependencies, reviewDependency } from "@/lib/knowledge/operational-graph";
import { backfillOperationalSources } from "@/lib/knowledge/operational-adapters";
import { OPERATIONAL_LENSES } from "@/lib/knowledge/operational-types";
const workspace = z.string().min(1).max(200);
export async function GET(request: NextRequest) {
  try {
    const user = await requireUser();
    if (request.nextUrl.searchParams.has("historyFor")) return NextResponse.json(await operationalHistory(user.id, workspace.parse(request.nextUrl.searchParams.get("workspaceId")), workspace.parse(request.nextUrl.searchParams.get("historyFor"))));
    if (request.nextUrl.searchParams.get("source") === "deployment") {
      const workspaceId = workspace.parse(request.nextUrl.searchParams.get("workspaceId"));
      const recordId = workspace.parse(request.nextUrl.searchParams.get("recordId"));
      await requireOperationalAccess(user.id, workspaceId);
      const projects = await db.project.findMany({ where: { workspaceId }, select: { id: true }, take: 200 });
      const record = await db.deployment.findFirst({ where: { id: recordId, repository: { projectId: { in: projects.map(project => project.id) } } }, select: { id: true, sha: true, environment: true, status: true, observedAt: true, source: true } });
      return record ? NextResponse.json(record) : NextResponse.json({ error: "Deployment not found" }, { status: 404 });
    }
    const params = z.object({ workspaceId: workspace, lens: z.enum(OPERATIONAL_LENSES).default("incident"), serviceId: z.string().max(200).optional() }).parse(Object.fromEntries(request.nextUrl.searchParams));
    return NextResponse.json(await operationalGraph(user.id, params.workspaceId, params.lens, params.serviceId));
  } catch (error) { if (error instanceof Error && error.message === "Unauthorized") return NextResponse.json({ error: "Unauthorized" }, { status: 401 }); return error instanceof z.ZodError ? NextResponse.json({ error: "Invalid operational query" }, { status: 400 }) : accessErrorResponse(error); }
}
const mutation = z.discriminatedUnion("action", [
  z.object({ action: z.literal("ingest"), workspaceId: workspace, event: z.unknown() }),
  z.object({ action: z.literal("discover"), workspaceId: workspace }),
  z.object({ action: z.literal("review"), workspaceId: workspace, edgeId: workspace, verdict: z.enum(["confirmed", "rejected"]) }),
  z.object({ action: z.literal("backfill"), workspaceId: workspace, cursor: z.string().max(1000).optional() }),
]);
export async function POST(request: NextRequest) {
  try {
    const user = await requireUser();
    const origin = request.headers.get("origin");
    if (origin && origin !== request.nextUrl.origin) return NextResponse.json({ error: "Cross-origin mutation denied" }, { status: 403 });
    if (Number(request.headers.get("content-length")) > 256000) return NextResponse.json({ error: "Payload too large" }, { status: 413 });
    const text = await request.text();
    if (text.length > 256000) return NextResponse.json({ error: "Payload too large" }, { status: 413 });
    const input = mutation.parse(JSON.parse(text));
    switch (input.action) {
      case "ingest": return NextResponse.json(await ingestOperationalEvent(user.id, input.workspaceId, input.event));
      case "discover": return NextResponse.json(await proposeDependencies(user.id, input.workspaceId));
      case "review": return NextResponse.json(await reviewDependency(user.id, input.workspaceId, input.edgeId, input.verdict));
      case "backfill": return NextResponse.json(await backfillOperationalSources(user.id, input.workspaceId, request.nextUrl.origin, input.cursor));
    }
  } catch (error) {
    if (error instanceof Error && error.message === "Unauthorized") return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    if (error instanceof z.ZodError || error instanceof SyntaxError) return NextResponse.json({ error: "Invalid operational payload" }, { status: 400 });
    return accessErrorResponse(error);
  }
}
