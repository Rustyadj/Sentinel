import { NextResponse } from "next/server";
import { db } from "@/lib/db";

function matchCount(q: string, ...fields: Array<string | null | undefined>): number {
  const needle = q.toLowerCase();
  return fields.reduce(
    (count, field) => count + (field?.toLowerCase().includes(needle) ? 1 : 0),
    0
  );
}

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const q = (searchParams.get("q") ?? "").trim();
  if (!q) return NextResponse.json({ notes: [], objects: [] });

  const [notes, objects] = await Promise.all([
    db.obsidianNote.findMany({
      where: {
        OR: [
          { title: { contains: q, mode: "insensitive" } },
          { content: { contains: q, mode: "insensitive" } },
        ],
      },
      select: { id: true, title: true, content: true, tags: true, projectId: true, updatedAt: true },
      take: 50,
    }),
    db.knowledgeObject.findMany({
      where: {
        OR: [
          { title: { contains: q, mode: "insensitive" } },
          { summary: { contains: q, mode: "insensitive" } },
        ],
      },
      select: { id: true, type: true, title: true, summary: true, scope: true, updatedAt: true },
      take: 50,
    }),
  ]);

  const rankedNotes = notes
    .map((n) => ({ ...n, score: matchCount(q, n.title, n.content) }))
    .sort((a, b) => b.score - a.score);

  const rankedObjects = objects
    .map((o) => ({ ...o, score: matchCount(q, o.title, o.summary) }))
    .sort((a, b) => b.score - a.score);

  return NextResponse.json({ notes: rankedNotes, objects: rankedObjects });
}
