import { db } from "@/lib/db";

export interface CreateTaskInput {
  chatRoomId: string;
  title: string;
  description?: string;
  ownerAgentId?: string;
  reviewerAgentId?: string;
  createdByAgentId?: string;
  dependsOnTaskIds?: string[];
}

export async function createRoomTask(input: CreateTaskInput) {
  return db.task.create({
    data: {
      chatRoomId: input.chatRoomId,
      title: input.title,
      description: input.description,
      status: input.ownerAgentId ? "QUEUED" : "PLANNED",
      agentId: input.ownerAgentId,
      reviewerAgentId: input.reviewerAgentId,
      createdByAgentId: input.createdByAgentId,
      dependsOnTaskIds: input.dependsOnTaskIds ?? [],
    },
  });
}

export async function dependenciesSatisfied(taskId: string): Promise<boolean> {
  const task = await db.task.findUnique({ where: { id: taskId }, select: { dependsOnTaskIds: true } });
  if (!task || task.dependsOnTaskIds.length === 0) return true;
  const deps = await db.task.findMany({ where: { id: { in: task.dependsOnTaskIds } }, select: { status: true } });
  return deps.every((dep) => dep.status === "COMPLETED");
}

export async function setTaskStatus(taskId: string, status: string) {
  return db.task.update({ where: { id: taskId }, data: { status } });
}

export async function claimTask(taskId: string, agentId: string) {
  return db.task.update({ where: { id: taskId }, data: { agentId, status: "CLAIMED" } });
}

export async function listRoomTasks(chatRoomId: string) {
  return db.task.findMany({ where: { chatRoomId }, orderBy: { createdAt: "asc" } });
}
