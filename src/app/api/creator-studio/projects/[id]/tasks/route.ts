import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/current-user";
import { requireOwnedProject } from "@/lib/creator-studio/access";
import { syncTaskToGraph } from "@/lib/creator-studio/graph";
import { db } from "@/lib/db";

type Params = { params: Promise<{ id: string }> };

export async function GET(_req: NextRequest, { params }: Params) {
  const user = await requireUser();
  const { id } = await params;
  if (!(await requireOwnedProject(id, user.id))) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  const tasks = await db.task.findMany({
    where: { contentProjectId: id },
    orderBy: [{ position: "asc" }, { createdAt: "desc" }],
  });
  return NextResponse.json(tasks);
}

export async function POST(req: NextRequest, { params }: Params) {
  const user = await requireUser();
  const { id } = await params;
  if (!(await requireOwnedProject(id, user.id))) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  const body = (await req.json()) as { title?: string; priority?: string };
  if (!body.title?.trim()) {
    return NextResponse.json({ error: "Missing required field: title" }, { status: 400 });
  }
  const task = await db.task.create({
    data: { contentProjectId: id, title: body.title.trim(), priority: body.priority ?? "medium" },
  });
  await syncTaskToGraph(task);
  return NextResponse.json(task, { status: 201 });
}
