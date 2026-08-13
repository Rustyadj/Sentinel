import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/current-user";
import { requireOwnedBrand } from "@/lib/creator-studio/access";
import { syncContentItemToGraph } from "@/lib/creator-studio/graph";
import { db } from "@/lib/db";

export async function GET(req: NextRequest) {
  const user = await requireUser();
  const brandId = req.nextUrl.searchParams.get("brandId");
  const projectId = req.nextUrl.searchParams.get("projectId");
  const type = req.nextUrl.searchParams.get("type");
  const status = req.nextUrl.searchParams.get("status");
  if (!brandId) {
    return NextResponse.json({ error: "Missing required query param: brandId" }, { status: 400 });
  }
  if (!(await requireOwnedBrand(brandId, user.id))) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const items = await db.contentItem.findMany({
    where: {
      brandId,
      projectId: projectId ?? undefined,
      type: type ?? undefined,
      status: status ?? undefined,
    },
    orderBy: [{ position: "asc" }, { createdAt: "desc" }],
  });
  return NextResponse.json(items);
}

export async function POST(req: NextRequest) {
  const user = await requireUser();
  const body = (await req.json()) as {
    brandId?: string;
    projectId?: string;
    sourceItemId?: string;
    title?: string;
    type?: string;
    platform?: string;
    content?: string;
    scheduledAt?: string;
  };
  if (!body.brandId || !body.title?.trim()) {
    return NextResponse.json({ error: "Missing required fields: brandId, title" }, { status: 400 });
  }
  if (!(await requireOwnedBrand(body.brandId, user.id))) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  if (body.sourceItemId) {
    const source = await db.contentItem.findUnique({ where: { id: body.sourceItemId } });
    if (!source || source.brandId !== body.brandId) {
      return NextResponse.json({ error: "Invalid sourceItemId" }, { status: 400 });
    }
  }

  const item = await db.contentItem.create({
    data: {
      brandId: body.brandId,
      projectId: body.projectId,
      sourceItemId: body.sourceItemId,
      title: body.title.trim(),
      type: body.type ?? "video",
      platform: body.platform,
      content: body.content,
      scheduledAt: body.scheduledAt ? new Date(body.scheduledAt) : undefined,
    },
  });
  await syncContentItemToGraph(item);
  return NextResponse.json(item, { status: 201 });
}
