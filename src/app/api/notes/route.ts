import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { resolveBacklinks } from "@/lib/knowledge/wikilinks";
import { applyTemplate } from "@/lib/knowledge/templates";

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const search = searchParams.get("q") ?? "";
  const projectId = searchParams.get("projectId") ?? undefined;
  const tags = searchParams.get("tags");
  const tagList = tags ? tags.split(",").map((t) => t.trim()).filter(Boolean) : undefined;

  const notes = await db.obsidianNote.findMany({
    where: {
      ...(projectId ? { projectId } : {}),
      ...(tagList && tagList.length > 0 ? { tags: { hasSome: tagList } } : {}),
      ...(search ? {
        OR: [
          { title: { contains: search, mode: "insensitive" } },
          { content: { contains: search, mode: "insensitive" } },
          { tags: { has: search } },
        ],
      } : {}),
    },
    orderBy: { updatedAt: "desc" },
    select: { id: true, title: true, tags: true, backlinks: true, projectId: true, createdAt: true, updatedAt: true },
  });
  return NextResponse.json(notes);
}

export async function POST(req: Request) {
  const body = await req.json() as {
    title?: string; content?: string; tags?: string[]; projectId?: string; templateId?: string;
  };

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
    },
  });

  await resolveBacklinks(note.id, note.content);

  return NextResponse.json(note);
}
