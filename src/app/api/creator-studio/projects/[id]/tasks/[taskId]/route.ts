import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/current-user";
import { requireOwnedProject } from "@/lib/creator-studio/access";
import { syncTaskToGraph, removeTaskFromGraph } from "@/lib/creator-studio/graph";
import { db } from "@/lib/db";

type Params = { params: Promise<{ id: string; taskId: string }> };

async function requireOwnedTask(projectId: string, taskId: string, userId: string) {
  if (!(await requireOwnedProject(projectId, userId))) return null;
  const task = await db.task.findUnique({ where: { id: taskId } });
  if (!task || task.contentProjectId !== projectId) return null;
  return task;
}

export async function PUT(req: NextRequest, { params }: Params) {
  const user = await requireUser();
  const { id, taskId } = await params;
  if (!(await requireOwnedTask(id, taskId, user.id))) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  const body = (await req.json()) as { title?: string; status?: string; priority?: string };
  const task = await db.task.update({
    where: { id: taskId },
    data: { title: body.title?.trim(), status: body.status, priority: body.priority },
  });
  await syncTaskToGraph(task);
  return NextResponse.json(task);
}

export async function DELETE(_req: NextRequest, { params }: Params) {
  const user = await requireUser();
  const { id, taskId } = await params;
  if (!(await requireOwnedTask(id, taskId, user.id))) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  await db.task.delete({ where: { id: taskId } });
  await removeTaskFromGraph(taskId);
  return NextResponse.json({ ok: true });
}
