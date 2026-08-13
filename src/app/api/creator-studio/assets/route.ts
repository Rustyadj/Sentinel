import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/current-user";
import { requireOwnedBrand } from "@/lib/creator-studio/access";
import { syncAssetToGraph } from "@/lib/creator-studio/graph";
import { db } from "@/lib/db";

export async function GET(req: NextRequest) {
  const user = await requireUser();
  const brandId = req.nextUrl.searchParams.get("brandId");
  const category = req.nextUrl.searchParams.get("category");
  if (!brandId) {
    return NextResponse.json({ error: "Missing required query param: brandId" }, { status: 400 });
  }
  if (!(await requireOwnedBrand(brandId, user.id))) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const assets = await db.asset.findMany({
    where: { brandId, category: category ?? undefined },
    orderBy: { createdAt: "desc" },
  });
  return NextResponse.json(assets);
}

export async function POST(req: NextRequest) {
  const user = await requireUser();
  const body = (await req.json()) as {
    brandId?: string;
    name?: string;
    category?: string;
    url?: string;
    mimeType?: string;
    sizeBytes?: number;
    tags?: string[];
  };
  if (!body.brandId || !body.name?.trim() || !body.category || !body.url?.trim()) {
    return NextResponse.json(
      { error: "Missing required fields: brandId, name, category, url" },
      { status: 400 }
    );
  }
  if (!(await requireOwnedBrand(body.brandId, user.id))) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const asset = await db.asset.create({
    data: {
      brandId: body.brandId,
      name: body.name.trim(),
      category: body.category,
      url: body.url.trim(),
      mimeType: body.mimeType,
      sizeBytes: body.sizeBytes,
      tags: body.tags ?? [],
    },
  });
  await syncAssetToGraph(asset);
  return NextResponse.json(asset, { status: 201 });
}
