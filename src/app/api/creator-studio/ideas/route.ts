import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/current-user";
import { requireOwnedBrand } from "@/lib/creator-studio/access";
import { syncIdeaToGraph } from "@/lib/creator-studio/graph";
import { db } from "@/lib/db";

const IDEA_SOURCES = [
  "manual",
  "voice_note",
  "url",
  "tweet",
  "article",
  "reddit",
  "youtube",
  "customer_question",
  "competitor",
];

export async function GET(req: NextRequest) {
  const user = await requireUser();
  const brandId = req.nextUrl.searchParams.get("brandId");
  if (!brandId) {
    return NextResponse.json({ error: "Missing required query param: brandId" }, { status: 400 });
  }
  if (!(await requireOwnedBrand(brandId, user.id))) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const ideas = await db.idea.findMany({
    where: { brandId },
    orderBy: { createdAt: "desc" },
  });
  return NextResponse.json(ideas);
}

export async function POST(req: NextRequest) {
  const user = await requireUser();
  const body = (await req.json()) as {
    brandId?: string;
    title?: string;
    content?: string;
    source?: string;
    sourceUrl?: string;
    tags?: string[];
  };
  if (!body.brandId || !body.title?.trim()) {
    return NextResponse.json({ error: "Missing required fields: brandId, title" }, { status: 400 });
  }
  if (!(await requireOwnedBrand(body.brandId, user.id))) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  const source = body.source && IDEA_SOURCES.includes(body.source) ? body.source : "manual";

  const idea = await db.idea.create({
    data: {
      brandId: body.brandId,
      title: body.title.trim(),
      content: body.content,
      source,
      sourceUrl: body.sourceUrl,
      tags: body.tags ?? [],
    },
  });
  await syncIdeaToGraph(idea);
  const synced = await db.idea.findUniqueOrThrow({ where: { id: idea.id } });
  return NextResponse.json(synced, { status: 201 });
}
