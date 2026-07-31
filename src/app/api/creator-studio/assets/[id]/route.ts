import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/current-user";
import { requireOwnedAsset } from "@/lib/creator-studio/access";
import { syncAssetToGraph, removeAssetFromGraph } from "@/lib/creator-studio/graph";
import { db } from "@/lib/db";

type Params = { params: Promise<{ id: string }> };

export async function PUT(req: NextRequest, { params }: Params) {
  const user = await requireUser();
  const { id } = await params;
  const existing = await requireOwnedAsset(id, user.id);
  if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const body = (await req.json()) as {
    name?: string;
    category?: string;
    url?: string;
    tags?: string[];
    bumpVersion?: boolean;
  };
  const asset = await db.asset.update({
    where: { id },
    data: {
      name: body.name?.trim(),
      category: body.category,
      url: body.url?.trim(),
      tags: body.tags,
      version: body.bumpVersion ? existing.version + 1 : undefined,
    },
  });
  await syncAssetToGraph(asset);
  return NextResponse.json(asset);
}

export async function DELETE(_req: NextRequest, { params }: Params) {
  const user = await requireUser();
  const { id } = await params;
  if (!(await requireOwnedAsset(id, user.id))) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  await db.asset.delete({ where: { id } });
  await removeAssetFromGraph(id);
  return NextResponse.json({ ok: true });
}
