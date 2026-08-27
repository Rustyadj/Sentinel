import { requireUser } from "@/lib/current-user";
import { listWorkspaces } from "@/lib/workspaces";
import { db } from "@/lib/db";
import { TasksConsole } from "@/modules/tasks/components/TasksConsole";

export const metadata = {
  title: "Tasks · Sentinel OS",
};

export default async function TasksPage() {
  const user = await requireUser();
  const workspaces = await listWorkspaces(user.id);
  const workspaceIds = workspaces.map((workspace) => workspace.id);

  const tasks = workspaceIds.length
    ? await db.task.findMany({
        where: { workspaceId: { in: workspaceIds } },
        include: {
          agent: { select: { id: true, name: true, color: true } },
          reviewerAgent: { select: { id: true, name: true, color: true } },
          workspace: { select: { id: true, name: true, color: true } },
          project: { select: { id: true, name: true } },
        },
        orderBy: [{ updatedAt: "desc" }],
        take: 200,
      })
    : [];

  return <TasksConsole tasks={tasks} />;
}
