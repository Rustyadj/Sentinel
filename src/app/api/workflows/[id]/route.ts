import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/current-user";
import { requireProjectPermission } from "@/lib/workspaces/authorization";

type Params = { params: Promise<{ id: string }> };
async function authorize(id: string, write: boolean) {
  const user = await requireUser();
  const workflow = await db.workflow.findUnique({ where: { id } });
  if (!workflow) return null;
  if (!workflow.projectId) return workflow.userId === user.id ? workflow : null;
  await requireProjectPermission(workflow.projectId, write ? "project.update" : "project.read");
  return workflow;
}

export async function GET(_req: Request, { params }: Params) {
  const { id } = await params; const workflow = await authorize(id, false).catch(() => null);
  return workflow ? NextResponse.json(workflow) : NextResponse.json({ error: "Not found" }, { status: 404 });
}
export async function PUT(req: Request, { params }: Params) {
  const { id } = await params; if (!(await authorize(id, true).catch(() => null))) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const body = await req.json();
  return NextResponse.json(await db.workflow.update({ where: { id }, data: {
    name: body.name, description: body.description, nodes: body.nodes, edges: body.edges, status: body.status,
  } }));
}
export async function DELETE(_req: Request, { params }: Params) {
  const { id } = await params; if (!(await authorize(id, true).catch(() => null))) return NextResponse.json({ error: "Not found" }, { status: 404 });
  await db.workflow.delete({ where: { id } }); return NextResponse.json({ ok: true });
}
