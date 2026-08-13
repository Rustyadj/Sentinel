import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/current-user";
import { requireOwnedProject } from "@/lib/creator-studio/access";
import { syncContentProjectToGraph, removeContentProjectFromGraph } from "@/lib/creator-studio/graph";
import { db } from "@/lib/db";

type Params = { params: Promise<{ id: string }> };

export async function GET(_req: NextRequest, { params }: Params) {
  const user = await requireUser();
  const { id } = await params;
  const project = await requireOwnedProject(id, user.id);
  if (!project) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json(project);
}

export async function PUT(req: NextRequest, { params }: Params) {
  const user = await requireUser();
  const { id } = await params;
  if (!(await requireOwnedProject(id, user.id))) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  const body = (await req.json()) as { name?: string; description?: string; status?: string };
  const project = await db.contentProject.update({
    where: { id },
    data: { name: body.name?.trim(), description: body.description?.trim(), status: body.status },
  });
  await syncContentProjectToGraph(project);
  return NextResponse.json(project);
}

export async function DELETE(_req: NextRequest, { params }: Params) {
  const user = await requireUser();
  const { id } = await params;
  if (!(await requireOwnedProject(id, user.id))) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  await db.contentProject.delete({ where: { id } });
  await removeContentProjectFromGraph(id);
  return NextResponse.json({ ok: true });
}
