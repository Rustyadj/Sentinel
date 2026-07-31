import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/current-user";
import { requireOwnedIdea } from "@/lib/creator-studio/access";
import { syncIdeaToGraph, removeIdeaFromGraph } from "@/lib/creator-studio/graph";
import { db } from "@/lib/db";

type Params = { params: Promise<{ id: string }> };

export async function GET(_req: NextRequest, { params }: Params) {
  const user = await requireUser();
  const { id } = await params;
  const idea = await requireOwnedIdea(id, user.id);
  if (!idea) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json(idea);
}

export async function PUT(req: NextRequest, { params }: Params) {
  const user = await requireUser();
  const { id } = await params;
  if (!(await requireOwnedIdea(id, user.id))) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  const body = (await req.json()) as {
    title?: string;
    content?: string;
    sourceUrl?: string;
    tags?: string[];
  };
  const idea = await db.idea.update({
    where: { id },
    data: {
      title: body.title?.trim(),
      content: body.content,
      sourceUrl: body.sourceUrl,
      tags: body.tags,
    },
  });
  await syncIdeaToGraph(idea);
  const synced = await db.idea.findUniqueOrThrow({ where: { id } });
  return NextResponse.json(synced);
}

export async function DELETE(_req: NextRequest, { params }: Params) {
  const user = await requireUser();
  const { id } = await params;
  if (!(await requireOwnedIdea(id, user.id))) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  await db.idea.delete({ where: { id } });
  await removeIdeaFromGraph(id);
  return NextResponse.json({ ok: true });
}
