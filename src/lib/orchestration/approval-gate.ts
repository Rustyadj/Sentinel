import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { RuntimeError } from "@/lib/agents/runtime/errors";

const HIGH_RISK_PATTERNS = [
  /prisma\s+migrate\s+(deploy|reset)/i,
  /drop\s+(table|database)/i,
  /truncate\s+table/i,
  /rm\s+-rf/i,
  /force[- ]?push/i,
  /delete\s+repository/i,
  /production/i,
];

const MEDIUM_RISK_PATTERNS = [
  /migration/i,
  /deploy/i,
  /secret/i,
  /credential/i,
  /auth(entication)?\s+config/i,
];

export function assessRisk(text: string): "low" | "medium" | "high" {
  if (HIGH_RISK_PATTERNS.some((re) => re.test(text))) return "high";
  if (MEDIUM_RISK_PATTERNS.some((re) => re.test(text))) return "medium";
  return "low";
}

export function requiresApproval(risk: "low" | "medium" | "high"): boolean {
  return risk !== "low";
}

async function resolveWorkspaceId(chatRoomId: string): Promise<string> {
  const room = await db.chatRoom.findUnique({
    where: { id: chatRoomId },
    select: { userId: true, project: { select: { workspaceId: true } } },
  });
  if (room?.project?.workspaceId) return room.project.workspaceId;
  const owned = room?.userId
    ? await db.workspace.findFirst({ where: { ownerId: room.userId }, orderBy: { createdAt: "asc" }, select: { id: true } })
    : null;
  if (owned) return owned.id;
  throw new RuntimeError("No workspace available to scope this approval request", "workspace_not_found", 400);
}

export interface RequestApprovalInput {
  chatRoomId: string;
  taskId?: string;
  requesterAgentId: string;
  title: string;
  description?: string;
  command: string;
  environment?: string;
}

export async function requestApprovalGate(input: RequestApprovalInput) {
  const workspaceId = await resolveWorkspaceId(input.chatRoomId);
  const risk = assessRisk(`${input.title} ${input.description ?? ""} ${input.command}`);
  return db.approvalRequest.create({
    data: {
      workspaceId,
      title: input.title,
      description: input.description,
      type: "agent_execution",
      requesterAgentId: input.requesterAgentId,
      chatRoomId: input.chatRoomId,
      taskId: input.taskId,
      risk,
      payload: { command: input.command, environment: input.environment ?? "workspace" } as Prisma.InputJsonValue,
    },
  });
}
