import { db } from "@/lib/db";
import { requireUser } from "@/lib/current-user";
import { recordProductionFailure } from "@/lib/learning/production-failures";
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser().catch(() => null);
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;
  const message = await db.message.findFirst({ where: { id, role: "assistant", chatRoom: { userId: user.id } }, include: { chatRoom: { include: { project: { select: { workspaceId: true } } } } } });
  if (!message) return Response.json({ error: "Not found" }, { status: 404 });
  const body = await request.json().catch(() => null);
  if (body?.rating !== "thumbs_down") return Response.json({ error: "Invalid rating" }, { status: 400 });
  const agent = message.agentId ? await db.agent.findUnique({ where: { id: message.agentId }, select: { workspaceId: true } }) : null;
  const result = await recordProductionFailure("thumbs_down", { sourceId: id, userId: user.id, workspaceId: message.chatRoom.project?.workspaceId ?? agent?.workspaceId,
    context: { messageId: id, response: message.content, feedback: typeof body.reason === "string" ? body.reason.slice(0, 2000) : "Response rejected by user" } });
  return Response.json({ recorded: true, evalCaseId: result.evalCase.id });
}
