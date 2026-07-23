import { NextRequest, NextResponse } from "next/server";
import { createEdge } from "@/lib/knowledge/edges";
import type { KnowledgeEdgeType } from "@/lib/knowledge/types";
import { requireUser } from "@/lib/current-user";
import { db } from "@/lib/db";

export async function GET(req: NextRequest) {
  const user = await requireUser().catch(() => null);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const fromObjectId = req.nextUrl.searchParams.get("fromObjectId") ?? undefined;
  const toObjectId = req.nextUrl.searchParams.get("toObjectId") ?? undefined;
  const ownedObjects = await db.knowledgeObject.findMany({
    where: { userId: user.id },
    select: { id: true }, take: 250,
  });
  const ids = ownedObjects.map(({ id }) => id);
  const edges = ids.length ? await db.knowledgeEdge.findMany({
    where: {
      fromObjectId: { in: ids }, toObjectId: { in: ids },
      ...(fromObjectId ? { fromObjectId } : {}),
      ...(toObjectId ? { toObjectId } : {}),
    }, take: 1000,
  }) : [];
  return NextResponse.json({ edges });
}

export async function POST(req: NextRequest) {
  const user = await requireUser().catch(() => null);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const body = await req.json();
  const { fromObjectId, toObjectId, type, weight } = body;
  if (!fromObjectId || !toObjectId || !type) return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
  const count = await db.knowledgeObject.count({ where: { id: { in: [fromObjectId, toObjectId] }, userId: user.id } });
  if (count !== 2) return NextResponse.json({ error: "Knowledge object not found" }, { status: 404 });
  return NextResponse.json(await createEdge({ fromObjectId, toObjectId, type: type as KnowledgeEdgeType, weight }), { status: 201 });
}
