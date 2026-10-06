import { notFound } from "next/navigation";
import { requireUser } from "@/lib/current-user";
import { db } from "@/lib/db";
import { requireWorkspacePermission, WorkspaceAccessError } from "@/lib/workspaces/authorization";
import { getTaskDetail } from "@/lib/tasks/detail";
import { TaskDetailConsole } from "@/modules/tasks/components/TaskDetailConsole";

export const metadata = {
  title: "Task · Sentinel OS",
};

export default async function TaskDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await requireUser();
  const detail = await getTaskDetail(id);
  if (!detail) notFound();

  if (detail.task.workspaceId) {
    try {
      await requireWorkspacePermission(detail.task.workspaceId, "task.read");
    } catch (error) {
      if (error instanceof WorkspaceAccessError) notFound();
      throw error;
    }
  } else if (detail.task.chatRoomId) {
    const room = await db.chatRoom.findUnique({ where: { id: detail.task.chatRoomId }, select: { userId: true } });
    if (room?.userId !== user.id) notFound();
  } else {
    notFound();
  }

  return <TaskDetailConsole detail={detail} />;
}
