import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/current-user";
import { getReadableProjectIds } from "@/lib/knowledge/access";

function matchCount(q: string, ...fields: Array<string | null | undefined>) {
  const needle = q.toLowerCase();
  return fields.reduce((count, field) => count + (field?.toLowerCase().includes(needle) ? 1 : 0), 0);
}

export async function GET(req: Request) {
  const user = await requireUser().catch(() => null);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const q = (new URL(req.url).searchParams.get("q") ?? "").trim().slice(0, 200);
  if (!q) return NextResponse.json({ notes: [], objects: [] });
  const projectIds = await getReadableProjectIds(user.id);
  const [notes, objects] = await Promise.all([
    db.obsidianNote.findMany({
      where: {
        AND: [
          { OR: [{ projectId: null, userId: user.id }, ...(projectIds.length ? [{ projectId: { in: projectIds } }] : [])] },
          { OR: [{ title: { contains: q, mode: "insensitive" } }, { content: { contains: q, mode: "insensitive" } }] },
        ],
      },
      select: { id: true, title: true, content: true, tags: true, projectId: true, updatedAt: true },
      take: 50,
    }),
    db.knowledgeObject.findMany({
      where: {
        userId: user.id,
        OR: [{ title: { contains: q, mode: "insensitive" } }, { summary: { contains: q, mode: "insensitive" } }],
      },
      select: { id: true, type: true, title: true, summary: true, scope: true, updatedAt: true },
      take: 50,
    }),
  ]);
  return NextResponse.json({
    notes: notes.map((item) => ({ ...item, score: matchCount(q, item.title, item.content) })).sort((a, b) => b.score - a.score),
    objects: objects.map((item) => ({ ...item, score: matchCount(q, item.title, item.summary) })).sort((a, b) => b.score - a.score),
  });
}
