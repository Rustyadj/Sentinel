import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { resolveBacklinks, removeBacklinksTo } from "@/lib/knowledge/wikilinks";
import { syncNoteToGraph, removeNoteFromGraph } from "@/lib/knowledge/notegraph";

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

  await db.obsidianNote.update({
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
  const finalNote = await db.obsidianNote.findUniqueOrThrow({ where: { id } });
  await syncNoteToGraph(finalNote);

  return NextResponse.json(finalNote);
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  await removeBacklinksTo(id);
  await db.obsidianNote.delete({ where: { id } });
  await removeNoteFromGraph(id);
  return NextResponse.json({ ok: true });
}
