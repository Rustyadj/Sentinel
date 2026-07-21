import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { resolveBacklinks } from "@/lib/knowledge/wikilinks";
import { applyTemplate } from "@/lib/knowledge/templates";
import { requireUser } from "@/lib/current-user";
import { getReadableProjectIds } from "@/lib/knowledge/access";
import { accessErrorResponse, requireProjectPermission } from "@/lib/workspaces/authorization";

export async function GET(req: Request) {
  try {
    const user = await requireUser();
    const { searchParams } = new URL(req.url);
    const search = searchParams.get("q") ?? "";
    const projectId = searchParams.get("projectId") ?? undefined;
    const tags = searchParams.get("tags");
    const tagList = tags ? tags.split(",").map((t) => t.trim()).filter(Boolean) : undefined;
    const readableProjectIds = projectId
      ? [(await requireProjectPermission(projectId, "project.read")).project.id]
      : await getReadableProjectIds(user.id);

    const notes = await db.obsidianNote.findMany({
      where: {
        AND: [
          {
            OR: [
              { projectId: null, userId: user.id },
              ...(readableProjectIds.length ? [{ projectId: { in: readableProjectIds } }] : []),
            ],
          },
          ...(projectId ? [{ projectId }] : []),
          ...(tagList?.length ? [{ tags: { hasSome: tagList } }] : []),
          ...(search ? [{
            OR: [
              { title: { contains: search, mode: "insensitive" as const } },
              { content: { contains: search, mode: "insensitive" as const } },
              { tags: { has: search } },
            ],
          }] : []),
        ],
      },
      orderBy: { updatedAt: "desc" },
      select: { id: true, title: true, tags: true, backlinks: true, projectId: true, createdAt: true, updatedAt: true },
    });
    return NextResponse.json(notes);
  } catch (error) {
    return accessErrorResponse(error);
  }
}

export async function POST(req: Request) {
  try {
    const user = await requireUser();
    const body = await req.json() as {
    title?: string; content?: string; tags?: string[]; projectId?: string; templateId?: string;
  };

    if (body.projectId) await requireProjectPermission(body.projectId, "document.create");
    const { title, content } = body.templateId
    ? applyTemplate(body.templateId, { title: body.title })
    : { title: body.title ?? "Untitled", content: body.content ?? "" };

    const note = await db.obsidianNote.create({
    data: {
      title,
      content,
      tags: body.tags ?? [],
      backlinks: [],
      projectId: body.projectId ?? null,
      userId: user.id,
    },
  });

    await resolveBacklinks(note.id, note.content, "", { userId: user.id, projectId: note.projectId });

    return NextResponse.json(note, { status: 201 });
  } catch (error) {
    return accessErrorResponse(error);
  }
}
