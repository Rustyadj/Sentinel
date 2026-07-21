import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/current-user";
import { getAccessibleWorkspaceIds } from "@/lib/agents/permissions";
import { accessErrorResponse, requireWorkspacePermission } from "@/lib/workspaces/authorization";

export async function GET(req: Request) {
  try {
    const user = await requireUser();
    const requestedId = new URL(req.url).searchParams.get("workspaceId");
    const accessibleIds = await getAccessibleWorkspaceIds(user.id);
    const workspaceId = requestedId ?? accessibleIds[0];
    if (!workspaceId || !accessibleIds.includes(workspaceId)) return NextResponse.json({ error: "Workspace not found" }, { status: 404 });
    await requireWorkspacePermission(workspaceId, "workspace.read");
    let chart = await db.orgChart.findFirst({ where: { workspaceId }, orderBy: { createdAt: "asc" } });
    if (!chart) chart = await db.orgChart.create({ data: { workspaceId, name: "Main", nodes: [], edges: [] } });
    return NextResponse.json(chart);
  } catch (error) { return accessErrorResponse(error); }
}

export async function PUT(req: Request) {
  try {
    const body = await req.json();
    if (!body.workspaceId || !Array.isArray(body.nodes) || !Array.isArray(body.edges)) {
      return NextResponse.json({ error: "workspaceId, nodes, and edges are required" }, { status: 400 });
    }
    await requireWorkspacePermission(body.workspaceId, "workspace.update");
    const chart = await db.orgChart.findFirst({ where: { workspaceId: body.workspaceId }, orderBy: { createdAt: "asc" } });
    const saved = chart
      ? await db.orgChart.update({ where: { id: chart.id }, data: { nodes: body.nodes, edges: body.edges } })
      : await db.orgChart.create({ data: { workspaceId: body.workspaceId, nodes: body.nodes, edges: body.edges } });
    return NextResponse.json(saved);
  } catch (error) { return accessErrorResponse(error); }
}
