import { notFound } from "next/navigation";
import { requireUser } from "@/lib/current-user";
import { getTaskDetail } from "@/lib/tasks/detail";
import { TaskDetailConsole } from "@/modules/tasks/components/TaskDetailConsole";

export const metadata = {
  title: "Task · Sentinel OS",
};

export default async function TaskDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await requireUser();
  // Not-found rather than forbidden: a task you cannot read is indistinguishable from one that does not exist.
  const detail = await getTaskDetail(id, user.id);
  if (!detail) notFound();
  return <TaskDetailConsole detail={detail} />;
}
