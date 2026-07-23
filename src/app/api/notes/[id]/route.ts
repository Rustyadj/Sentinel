import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { resolveBacklinks, removeBacklinksTo } from "@/lib/knowledge/wikilinks";
import { requireNotePermission } from "@/lib/knowledge/access";
import { accessErrorResponse, requireProjectPermission } from "@/lib/workspaces/authorization";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    await requireNotePermission(id, "project.read");
    return NextResponse.json(await db.obsidianNote.findUnique({ where: { id } }));
  } catch (error) {
    return accessErrorResponse(error);
  }
}

export async function PUT(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const { user, note: accessibleNote } = await requireNotePermission(id, "document.update");
    const body = await req.json();
    if (body.projectId && body.projectId !== accessibleNote.projectId) {
      await requireProjectPermission(body.projectId, "document.create");
    }

    const previous = await db.obsidianNote.findUnique({ where: { id }, select: { content: true } });

    const note = await db.obsidianNote.update({
    where: { id },
    data: {
      title: body.title,
      content: body.content,
      tags: body.tags ?? [],
      projectId: body.projectId ?? null,
      userId: user.id,
    },
  });

  // Reconcile backlinks: add newly-linked notes, remove no-longer-linked ones
    await resolveBacklinks(id, body.content ?? "", previous?.content ?? "", {
      userId: user.id,
      projectId: note.projectId,
    });

    return NextResponse.json(note);
  } catch (error) {
    return accessErrorResponse(error);
  }
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const { user, note } = await requireNotePermission(id, "document.update");
    await removeBacklinksTo(id, { userId: user.id, projectId: note.projectId });
    await db.obsidianNote.delete({ where: { id } });
    return NextResponse.json({ ok: true });
  } catch (error) {
    return accessErrorResponse(error);
  }
}
