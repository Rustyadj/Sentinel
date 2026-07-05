import { NextRequest, NextResponse } from "next/server";
import { createEdge, listEdges } from "@/lib/knowledge/edges";
import type { KnowledgeEdgeType } from "@/lib/knowledge/types";

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = req.nextUrl;
    const fromObjectId = searchParams.get("fromObjectId") ?? undefined;
    const toObjectId = searchParams.get("toObjectId") ?? undefined;
    const type = searchParams.get("type") as KnowledgeEdgeType | undefined;

    const edges = await listEdges({ fromObjectId, toObjectId, type });
    return NextResponse.json({ edges });
  } catch {
    return NextResponse.json({ edges: [] });
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { fromObjectId, toObjectId, type, weight } = body;

    if (!fromObjectId || !toObjectId || !type) {
      return NextResponse.json(
        { error: "Missing required fields: fromObjectId, toObjectId, type" },
        { status: 400 }
      );
    }

    const edge = await createEdge({
      fromObjectId,
      toObjectId,
      type: type as KnowledgeEdgeType,
      weight,
    });

    return NextResponse.json(edge, { status: 201 });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Internal error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
