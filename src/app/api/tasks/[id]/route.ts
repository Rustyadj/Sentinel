import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { writeAuditLog } from "@/lib/workspaces/audit";
import { accessErrorResponse, requireWorkspacePermission } from "@/lib/workspaces/authorization";
import { assertOneOf, TASK_PRIORITIES, TASK_STATUSES } from "@/lib/workspaces/status";

type Context = { params: Promise<{ id: string }> };

export async function PATCH(req: NextRequest, { params }: Context) {
  try {
    const { id } = await params;
    const current = await db.task.findUniqueOrThrow({ where: { id } });
    if (!current.workspaceId) return NextResponse.json({ error: "Task is not workspace-scoped" }, { status: 400 });
    const user = await requireWorkspacePermission(current.workspaceId, "task.update");
    const body = await req.json();
    assertOneOf(body.status, TASK_STATUSES, "status");
    assertOneOf(body.priority, TASK_PRIORITIES, "priority");
    const task = await db.task.update({
      where: { id },
      data: {
        ...(body.title !== undefined ? { title: body.title } : {}),
        ...(body.description !== undefined ? { description: body.description } : {}),
        ...(body.status !== undefined ? { status: body.status } : {}),
        ...(body.priority !== undefined ? { priority: body.priority } : {}),
        ...(body.assignee !== undefined ? { assignee: body.assignee } : {}),
        ...(body.agentId !== undefined ? { agentId: body.agentId } : {}),
        ...(body.position !== undefined ? { position: body.position } : {}),
      },
    });
    await writeAuditLog({ workspaceId: task.workspaceId, projectId: task.projectId, userId: user.id, action: "task.updated", entityType: "task", entityId: id, details: { previousStatus: current.status, status: task.status } });
    return NextResponse.json(task);
  } catch (error) {
    return accessErrorResponse(error);
  }
}

export async function DELETE(_req: NextRequest, { params }: Context) {
  try {
    const { id } = await params;
    const task = await db.task.findUniqueOrThrow({ where: { id } });
    if (!task.workspaceId) return NextResponse.json({ error: "Task is not workspace-scoped" }, { status: 400 });
    const user = await requireWorkspacePermission(task.workspaceId, "task.delete");
    await writeAuditLog({ workspaceId: task.workspaceId, projectId: task.projectId, userId: user.id, action: "task.deleted", entityType: "task", entityId: id });
    await db.task.delete({ where: { id } });
    return new NextResponse(null, { status: 204 });
  } catch (error) {
    return accessErrorResponse(error);
  }
}
