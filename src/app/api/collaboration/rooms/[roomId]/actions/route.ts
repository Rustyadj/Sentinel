import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/current-user";
import { collaborationErrorResponse, requireRoomAccess } from "@/lib/orchestration/access";
import { emitCollaborationEvent } from "@/lib/orchestration/event-bus";
import { setTaskStatus, createRoomTask } from "@/lib/orchestration/task-router";
import { releaseAgentLocks } from "@/lib/orchestration/execution-lock";

type Context = { params: Promise<{ roomId: string }> };

type ActionBody =
  | { type: "assignTask"; title: string; ownerAgentId?: string }
  | { type: "cancelTask"; taskId: string }
  | { type: "reassignTask"; taskId: string; ownerAgentId: string }
  | { type: "stopAgent"; agentId: string }
  | { type: "resolveDisagreement"; disagreementId: string; agentId: string }
  | { type: "setMode"; mode: "solo" | "collaborative" | "autonomous" }
  | { type: "setPaused"; paused: boolean };

export async function POST(req: NextRequest, { params }: Context) {
  try {
    const user = await requireUser();
    const { roomId } = await params;
    await requireRoomAccess(roomId, user.id);
    const body = (await req.json()) as ActionBody;

    switch (body.type) {
      case "assignTask": {
        if (!body.title?.trim()) return NextResponse.json({ error: "title is required" }, { status: 400 });
        const task = await createRoomTask({ chatRoomId: roomId, title: body.title.trim(), ownerAgentId: body.ownerAgentId, createdByAgentId: "user" });
        await emitCollaborationEvent(roomId, "task.created", { taskId: task.id, title: task.title, ownerAgentId: body.ownerAgentId });
        return NextResponse.json({ task });
      }
      case "cancelTask": {
        const task = await setTaskStatus(body.taskId, "CANCELLED");
        await emitCollaborationEvent(roomId, "execution.finished", { taskId: task.id, status: "cancelled" });
        return NextResponse.json({ task });
      }
      case "reassignTask": {
        const task = await db.task.update({ where: { id: body.taskId }, data: { agentId: body.ownerAgentId, status: "QUEUED" } });
        await emitCollaborationEvent(roomId, "task.claimed", { taskId: task.id, agentId: body.ownerAgentId, reassigned: true });
        return NextResponse.json({ task });
      }
      case "stopAgent": {
        await releaseAgentLocks(roomId, body.agentId);
        await db.agentSession.updateMany({
          where: { chatRoomId: roomId, agentId: body.agentId, status: { notIn: ["completed", "failed", "cancelled", "timed_out"] } },
          data: { status: "cancelled", cancelledAt: new Date() },
        });
        await emitCollaborationEvent(roomId, "agent.finished", { agentId: body.agentId, stoppedBy: "user" });
        return NextResponse.json({ ok: true });
      }
      case "resolveDisagreement": {
        const disagreement = await db.agentDisagreement.findUniqueOrThrow({ where: { id: body.disagreementId } });
        const positions = Array.isArray(disagreement.positions) ? (disagreement.positions as { agentId: string; position: string }[]) : [];
        const position = positions.find((entry) => entry.agentId === body.agentId)?.position;
        const resolved = await db.agentDisagreement.update({
          where: { id: body.disagreementId },
          data: { resolvedByAgentId: body.agentId, finalDecision: position, resolvedAt: new Date() },
        });
        if (position) {
          await db.decision.create({
            data: {
              title: position,
              summary: "Operator resolved the visible agent disagreement.",
              createdBy: body.agentId,
              approvedBy: "user",
              chatRoomId: roomId,
              relatedTaskIds: disagreement.taskId ? [disagreement.taskId] : [],
            },
          });
          await emitCollaborationEvent(roomId, "decision.created", { disagreementId: disagreement.id });
        }
        return NextResponse.json({ disagreement: resolved });
      }
      case "setMode": {
        const room = await db.chatRoom.update({ where: { id: roomId }, data: { mode: body.mode } });
        return NextResponse.json({ mode: room.mode });
      }
      case "setPaused": {
        const room = await db.chatRoom.update({ where: { id: roomId }, data: { paused: body.paused } });
        await emitCollaborationEvent(roomId, body.paused ? "agent.finished" : "agent.started", { pausedByUser: body.paused });
        return NextResponse.json({ paused: room.paused });
      }
      default:
        return NextResponse.json({ error: "Unknown action type" }, { status: 400 });
    }
  } catch (error) {
    return collaborationErrorResponse(error);
  }
}
