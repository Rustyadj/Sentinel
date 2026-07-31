import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/current-user";
import { requireOwnedItem } from "@/lib/creator-studio/access";
import { syncContentItemToGraph, removeContentItemFromGraph } from "@/lib/creator-studio/graph";
import { db } from "@/lib/db";

type Params = { params: Promise<{ id: string }> };

export async function GET(_req: NextRequest, { params }: Params) {
  const user = await requireUser();
  const { id } = await params;
  const item = await requireOwnedItem(id, user.id);
  if (!item) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const hooks = await db.contentHook.findMany({ where: { contentItemId: id }, orderBy: { createdAt: "desc" } });
  return NextResponse.json({ ...item, hooks });
}

export async function PUT(req: NextRequest, { params }: Params) {
  const user = await requireUser();
  const { id } = await params;
  if (!(await requireOwnedItem(id, user.id))) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  const body = (await req.json()) as {
    title?: string;
    status?: string;
    scheduledAt?: string | null;
    position?: number;
    content?: string;
    description?: string;
    thumbnailUrl?: string | null;
    tags?: string[];
    chapters?: Array<{ timestamp: string; title: string }>;
    outline?: Array<{ id: string; text: string }>;
  };
  const item = await db.contentItem.update({
    where: { id },
    data: {
      title: body.title?.trim(),
      status: body.status,
      position: body.position,
      content: body.content,
      description: body.description,
      thumbnailUrl: body.thumbnailUrl,
      tags: body.tags,
      chapters: body.chapters,
      outline: body.outline,
      scheduledAt:
        body.scheduledAt === undefined ? undefined : body.scheduledAt ? new Date(body.scheduledAt) : null,
    },
  });
  await syncContentItemToGraph(item);
  return NextResponse.json(item);
}

export async function DELETE(_req: NextRequest, { params }: Params) {
  const user = await requireUser();
  const { id } = await params;
  if (!(await requireOwnedItem(id, user.id))) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  await db.contentItem.delete({ where: { id } });
  await removeContentItemFromGraph(id);
  return NextResponse.json({ ok: true });
}
