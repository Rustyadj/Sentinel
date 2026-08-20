import { db } from "@/lib/db";

export interface BuildContextInput {
  chatRoomId: string;
  taskId: string;
  agentId: string;
  extra?: string;
}

/**
 * Builds a scoped prompt for one agent turn: room objective, the task at
 * hand, its dependencies' titles/status, a handful of recent decisions,
 * and the recent discussion on this task only — never the full room
 * history (spec's context builder is explicit that agents shouldn't get
 * everything, just what's relevant to the task in front of them).
 */
export async function buildAgentContext(input: BuildContextInput): Promise<string> {
  const [room, task, decisions, messages] = await Promise.all([
    db.chatRoom.findUnique({ where: { id: input.chatRoomId }, select: { name: true, objective: true } }),
    db.task.findUnique({ where: { id: input.taskId } }),
    db.decision.findMany({ where: { chatRoomId: input.chatRoomId }, orderBy: { createdAt: "desc" }, take: 5 }),
    db.message.findMany({
      where: { chatRoomId: input.chatRoomId, taskId: input.taskId },
      orderBy: { createdAt: "desc" },
      take: 10,
    }),
  ]);
  if (!task) throw new Error("Task not found");

  const dependencies = task.dependsOnTaskIds.length
    ? await db.task.findMany({ where: { id: { in: task.dependsOnTaskIds } }, select: { title: true, status: true } })
    : [];

  const lines: string[] = [];
  lines.push(`Room: ${room?.name ?? input.chatRoomId}`);
  if (room?.objective) lines.push(`Objective: ${room.objective}`);
  lines.push(`Task: ${task.title}`);
  if (task.description) lines.push(`Task description: ${task.description}`);
  if (dependencies.length) {
    lines.push(`Dependencies: ${dependencies.map((dep) => `${dep.title} (${dep.status})`).join(", ")}`);
  }
  if (decisions.length) {
    lines.push("Relevant decisions:");
    for (const decision of decisions) lines.push(`- ${decision.title}: ${decision.summary}`);
  }
  if (messages.length) {
    lines.push("Recent task discussion:");
    for (const message of [...messages].reverse()) {
      lines.push(`- [${message.messageType}] ${message.agentId ?? "user"}: ${message.content}`);
    }
  }
  if (input.extra) lines.push(input.extra);
  return lines.join("\n");
}
