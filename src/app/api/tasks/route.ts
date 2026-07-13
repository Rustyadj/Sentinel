import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/current-user";
import { writeAuditLog } from "@/lib/workspaces/audit";
import { accessErrorResponse, requireWorkspacePermission } from "@/lib/workspaces/authorization";
import { assertOneOf, TASK_PRIORITIES, TASK_STATUSES, type TaskPriority, type TaskStatus } from "@/lib/workspaces/status";

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const workspaceId = searchParams.get("workspaceId") ?? undefined;
    const projectId = searchParams.get("projectId") ?? undefined;
    const status = searchParams.get("status") ?? undefined;
    if (workspaceId) await requireWorkspacePermission(workspaceId, "task.read");
    else await requireUser();
    const tasks = await db.task.findMany({
      where: {
        ...(workspaceId ? { workspaceId } : {}),
        ...(projectId ? { projectId } : {}),
        ...(status ? { status } : {}),
      },
      orderBy: [{ position: "asc" }, { createdAt: "desc" }],
    });
    return NextResponse.json(tasks);
  } catch (error) {
    return accessErrorResponse(error);
  }
}

export async function POST(req: Request) {
  const body = await req.json() as {
    title: string; description?: string; status?: TaskStatus;
    priority?: TaskPriority; workspaceId?: string; projectId?: string; teamId?: string; agentId?: string;
    assignee?: string; dueDate?: string; tags?: string[];
  };
  try {
    if (!body.title?.trim()) return NextResponse.json({ error: "title is required" }, { status: 400 });
    assertOneOf(body.status, TASK_STATUSES, "status");
    assertOneOf(body.priority, TASK_PRIORITIES, "priority");
    const user = body.workspaceId
      ? await requireWorkspacePermission(body.workspaceId, "task.create")
      : await requireUser();
    const task = await db.task.create({
      data: {
        title: body.title,
        description: body.description ?? null,
        status: body.status ?? "backlog",
        priority: body.priority ?? "medium",
        workspaceId: body.workspaceId ?? null,
        projectId: body.projectId ?? null,
        teamId: body.teamId ?? null,
        agentId: body.agentId ?? null,
        assignee: body.assignee ?? null,
        dueDate: body.dueDate ? new Date(body.dueDate) : null,
        tags: body.tags ?? [],
      },
    });
    await writeAuditLog({ workspaceId: task.workspaceId, projectId: task.projectId, userId: user.id, action: "task.created", entityType: "task", entityId: task.id, details: { title: task.title, status: task.status } });
    return NextResponse.json(task, { status: 201 });
  } catch (error) {
    return accessErrorResponse(error);
  }
}
