import { NextRequest, NextResponse } from "next/server";
import type { Prisma } from "@prisma/client";
import { requireUser } from "@/lib/current-user";
import { db } from "@/lib/db";
import { syncBrandToGraph, removeBrandFromGraph } from "@/lib/creator-studio/graph";

type Params = { params: Promise<{ id: string }> };

async function requireOwnedBrand(id: string, userId: string) {
  const brand = await db.brand.findUnique({ where: { id } });
  if (!brand || brand.ownerId !== userId) return null;
  return brand;
}

export async function GET(_req: NextRequest, { params }: Params) {
  const user = await requireUser();
  const { id } = await params;
  const brand = await db.brand.findUnique({
    where: { id },
    include: { profile: true, _count: { select: { ideas: true } } },
  });
  if (!brand || brand.ownerId !== user.id) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  return NextResponse.json(brand);
}

export async function PUT(req: NextRequest, { params }: Params) {
  const user = await requireUser();
  const { id } = await params;
  const owned = await requireOwnedBrand(id, user.id);
  if (!owned) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const body = (await req.json()) as {
    name?: string;
    profile?: Partial<{
      logoUrl: string | null;
      primaryColor: string;
      secondaryColor: string;
      typography: Prisma.InputJsonValue;
      mission: string | null;
      targetAudience: string | null;
      painPoints: string[];
      toneOfVoice: string | null;
      products: string[];
      services: string[];
      competitors: string[];
      frequentPhrases: string[];
      wordsToAvoid: string[];
      ctaPreferences: string | null;
      thumbnailStyle: string | null;
      videoStyle: string | null;
      hookStyle: string | null;
      seoKeywords: string[];
    }>;
  };

  const brand = await db.brand.update({
    where: { id },
    data: {
      name: body.name?.trim(),
      profile: body.profile
        ? { upsert: { create: body.profile, update: body.profile } }
        : undefined,
    },
    include: { profile: true },
  });
  await syncBrandToGraph(brand);
  return NextResponse.json(brand);
}

export async function DELETE(_req: NextRequest, { params }: Params) {
  const user = await requireUser();
  const { id } = await params;
  const owned = await requireOwnedBrand(id, user.id);
  if (!owned) return NextResponse.json({ error: "Not found" }, { status: 404 });

  await db.brand.delete({ where: { id } });
  await removeBrandFromGraph(id);
  return NextResponse.json({ ok: true });
}
