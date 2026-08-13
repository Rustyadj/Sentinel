import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/current-user";
import { db } from "@/lib/db";

export async function GET(req: NextRequest) {
  const user = await requireUser();
  const brandId = req.nextUrl.searchParams.get("brandId");

  const brandCount = await db.brand.count({ where: { ownerId: user.id } });

  if (!brandId) {
    return NextResponse.json({ brandCount, ideaCount: 0 });
  }

  const brand = await db.brand.findUnique({ where: { id: brandId } });
  if (!brand || brand.ownerId !== user.id) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const ideaCount = await db.idea.count({ where: { brandId } });

  return NextResponse.json({ brandCount, ideaCount });
}
