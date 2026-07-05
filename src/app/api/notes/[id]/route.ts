import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { resolveBacklinks, removeBacklinksTo } from "@/lib/knowledge/wikilinks";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const note = await db.obsidianNote.findUnique({ where: { id } });
  if (!note) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json(note);
}

export async function PUT(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = await req.json();

  const previous = await db.obsidianNote.findUnique({ where: { id }, select: { content: true } });

  const note = await db.obsidianNote.update({
    where: { id },
    data: {
      title: body.title,
      content: body.content,
      tags: body.tags ?? [],
      projectId: body.projectId ?? null,
    },
  });

  // Reconcile backlinks: add newly-linked notes, remove no-longer-linked ones
  await resolveBacklinks(id, body.content ?? "", previous?.content ?? "");

  return NextResponse.json(note);
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  await removeBacklinksTo(id);
  await db.obsidianNote.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}
