import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/current-user";
import { getReadableProjectIds } from "@/lib/knowledge/access";
import { requireProjectPermission } from "@/lib/workspaces/authorization";
import { syncWorkflowToGraph } from "@/lib/knowledge/entity-sync";

export async function GET() {
  const user = await requireUser().catch(() => null);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const projectIds = await getReadableProjectIds(user.id);
  return NextResponse.json(await db.workflow.findMany({
    where: { OR: [{ userId: user.id, projectId: null }, ...(projectIds.length ? [{ projectId: { in: projectIds } }] : [])] },
    orderBy: { updatedAt: "desc" },
  }));
}

export async function POST(req: Request) {
  const user = await requireUser().catch(() => null);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const body = await req.json();
  if (body.projectId) await requireProjectPermission(body.projectId, "project.update");
  const workflow = await db.workflow.create({
    data: {
      userId: user.id, projectId: body.projectId ?? null,
      name: body.name ?? "New Workflow", description: body.description ?? "",
      nodes: body.nodes ?? [], edges: body.edges ?? [], status: "draft",
    },
  });
  await syncWorkflowToGraph(workflow).catch((err) => console.error("[workflows] graph sync failed (non-fatal):", err));
  return NextResponse.json(workflow, { status: 201 });
}
