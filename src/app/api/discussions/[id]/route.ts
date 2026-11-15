import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/current-user";
import { getVpsAgent } from "@/lib/agents/registry";
import { requireDiscussionAccess } from "@/lib/roundtable/access";
import { cancelDiscussion, continueDiscussion, failIfStalled } from "@/lib/roundtable/engine";
import { roundtableErrorResponse } from "@/lib/roundtable/http";

type Context = { params: Promise<{ id: string }> };

/** The whole discussion. The page reads this on a short interval while agents are speaking. */
export async function GET(_req: NextRequest, { params }: Context) {
  try {
    const user = await requireUser();
    const { id } = await params;
    await requireDiscussionAccess(id, user.id, "read");
    await failIfStalled(id);
    const discussion = await db.discussion.findUniqueOrThrow({
      where: { id },
      include: { turns: { orderBy: { sequence: "asc" } }, project: { select: { name: true } }, createdBy: { select: { name: true } } },
    });
    const authorIds = [...new Set(discussion.turns.flatMap((t) => (t.authorUserId ? [t.authorUserId] : [])))];
    const authors = authorIds.length ? await db.user.findMany({ where: { id: { in: authorIds } }, select: { id: true, name: true } }) : [];
    const personName = new Map(authors.map((a) => [a.id, a.name ?? "Someone"]));

    return NextResponse.json({
      id: discussion.id, title: discussion.title, topic: discussion.topic, status: discussion.status, error: discussion.error,
      rounds: discussion.rounds, createdAt: discussion.createdAt, completedAt: discussion.completedAt,
      projectId: discussion.projectId, projectName: discussion.project?.name ?? null,
      startedBy: discussion.createdBy.name ?? "Someone", mine: discussion.createdById === user.id,
      agents: discussion.agentIds.map((agentId) => ({ id: agentId, name: getVpsAgent(agentId)?.name ?? agentId })),
      turns: discussion.turns.map((turn) => ({
        id: turn.id, sequence: turn.sequence, round: turn.round, kind: turn.kind, status: turn.status, error: turn.error,
        agentId: turn.agentId, content: turn.content, position: turn.position, startedAt: turn.startedAt, completedAt: turn.completedAt,
        speaker: turn.agentId ? getVpsAgent(turn.agentId)?.name ?? turn.agentId : personName.get(turn.authorUserId ?? "") ?? "Someone",
        mine: Boolean(turn.authorUserId) && turn.authorUserId === user.id,
      })),
    });
  } catch (error) {
    return roundtableErrorResponse(error);
  }
}

export async function POST(req: NextRequest, { params }: Context) {
  try {
    const user = await requireUser();
    const { id } = await params;
    const body = (await req.json().catch(() => null)) as { action?: unknown } | null;
    if (body?.action === "cancel") {
      await requireDiscussionAccess(id, user.id, "write");
      await cancelDiscussion(id);
      return NextResponse.json({ ok: true });
    }
    if (body?.action === "continue") {
      await requireDiscussionAccess(id, user.id, "write");
      // continueDiscussion re-checks that this person may run each seated agent.
      await continueDiscussion(id, user);
      return NextResponse.json({ ok: true }, { status: 202 });
    }
    return NextResponse.json({ error: "action must be cancel or continue" }, { status: 400 });
  } catch (error) {
    return roundtableErrorResponse(error);
  }
}

export async function DELETE(_req: NextRequest, { params }: Context) {
  try {
    const user = await requireUser();
    const { id } = await params;
    const discussion = await requireDiscussionAccess(id, user.id, "write");
    if (discussion.createdById !== user.id) return NextResponse.json({ error: "Only the person who started a roundtable can delete it." }, { status: 403 });
    await cancelDiscussion(id);
    await db.discussion.delete({ where: { id } });
    return NextResponse.json({ ok: true });
  } catch (error) {
    return roundtableErrorResponse(error);
  }
}
