import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/current-user";
import { db } from "@/lib/db";
import { syncBrandToGraph } from "@/lib/creator-studio/graph";

export async function GET() {
  const user = await requireUser();
  const brands = await db.brand.findMany({
    where: { ownerId: user.id },
    include: { profile: true, _count: { select: { ideas: true } } },
    orderBy: { createdAt: "asc" },
  });
  return NextResponse.json(brands);
}

export async function POST(req: NextRequest) {
  const user = await requireUser();
  const body = (await req.json()) as { name?: string; slug?: string };
  if (!body.name?.trim()) {
    return NextResponse.json({ error: "Missing required field: name" }, { status: 400 });
  }
  const slug =
    body.slug?.trim().toLowerCase() ||
    body.name
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/(^-|-$)/g, "");

  const existing = await db.brand.findUnique({ where: { slug } });
  if (existing) {
    return NextResponse.json({ error: `Brand slug "${slug}" already exists` }, { status: 409 });
  }

  const brand = await db.brand.create({
    data: {
      ownerId: user.id,
      name: body.name.trim(),
      slug,
      profile: { create: {} },
    },
    include: { profile: true },
  });
  await syncBrandToGraph(brand);
  return NextResponse.json(brand, { status: 201 });
}
