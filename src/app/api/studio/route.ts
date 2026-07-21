import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/current-user";

export async function GET() {
  const user = await requireUser().catch(() => null);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const projects = await db.obsidianNote.findMany({
    where: { userId: user.id, projectId: null, tags: { has: "studio-project" } },
    orderBy: { updatedAt: "desc" },
    select: { id: true, title: true, tags: true, updatedAt: true, createdAt: true },
  });
  return NextResponse.json(projects);
}

export async function POST(req: Request) {
  const user = await requireUser().catch(() => null);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const body = (await req.json()) as {
    title: string;
    content: string;
    tags?: string[];
  };
  const project = await db.obsidianNote.create({
    data: {
      title: body.title ?? "Untitled Design",
      content: body.content ?? "",
      tags: ["studio-project", ...(body.tags ?? [])],
      backlinks: [],
      userId: user.id,
    },
  });
  return NextResponse.json(project);
}
