import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { errorResponse, HttpError, readBody, requireBotAdmin } from "@/lib/bots/api";
import { cancelBotTask, getBotTask, resolveBotTaskApproval } from "@/lib/bots/tasks";

type Ctx = { params: Promise<{ taskId: string }> };

async function authorize(taskId: string) {
  const run = await db.orchestrationRun.findFirst({ where: { id: taskId, botId: { not: null } }, select: { workspaceId: true } });
  if (!run?.workspaceId) throw new HttpError("Task not found", 404);
  const user = await requireBotAdmin(run.workspaceId).catch((error: unknown) => {
    if (error instanceof HttpError && error.status === 401) throw new HttpError("Task not found", 404);
    throw error;
  });
  return user;
}

export async function GET(_request: Request, { params }: Ctx) {
  try {
    const { taskId } = await params;
    const user = await authorize(taskId);
    return NextResponse.json({ task: await getBotTask(taskId, { userId: user.id, isAdmin: true }) });
  } catch (error) { return errorResponse(error); }
}

/** cancel | approve | deny (the last two resolve a WAITING task's tool approval). */
export async function POST(request: Request, { params }: Ctx) {
  try {
    const { taskId } = await params;
    const user = await authorize(taskId);
    const body = await readBody(request);
    const viewer = { userId: user.id, isAdmin: true as const };
    switch (body.action) {
      case "cancel": return NextResponse.json(await cancelBotTask(taskId, viewer));
      case "approve": return NextResponse.json(await resolveBotTaskApproval(taskId, "approve", viewer));
      case "deny": return NextResponse.json(await resolveBotTaskApproval(taskId, "deny", viewer));
      default: throw new HttpError("action must be cancel, approve or deny", 400);
    }
  } catch (error) { return errorResponse(error); }
}
