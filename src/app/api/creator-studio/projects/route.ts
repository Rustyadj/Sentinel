import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/current-user";
import { requireOwnedBrand } from "@/lib/creator-studio/access";
import { syncContentProjectToGraph } from "@/lib/creator-studio/graph";
import { db } from "@/lib/db";

export async function GET(req: NextRequest) {
  const user = await requireUser();
  const brandId = req.nextUrl.searchParams.get("brandId");
  if (!brandId) {
    return NextResponse.json({ error: "Missing required query param: brandId" }, { status: 400 });
  }
  if (!(await requireOwnedBrand(brandId, user.id))) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const projects = await db.contentProject.findMany({
    where: { brandId },
    include: { _count: { select: { items: true, tasks: true } } },
    orderBy: { createdAt: "desc" },
  });
  return NextResponse.json(projects);
}

export async function POST(req: NextRequest) {
  const user = await requireUser();
  const body = (await req.json()) as { brandId?: string; name?: string; description?: string };
  if (!body.brandId || !body.name?.trim()) {
    return NextResponse.json({ error: "Missing required fields: brandId, name" }, { status: 400 });
  }
  if (!(await requireOwnedBrand(body.brandId, user.id))) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const project = await db.contentProject.create({
    data: { brandId: body.brandId, name: body.name.trim(), description: body.description?.trim() },
    include: { _count: { select: { items: true, tasks: true } } },
  });
  await syncContentProjectToGraph(project);
  return NextResponse.json(project, { status: 201 });
}
