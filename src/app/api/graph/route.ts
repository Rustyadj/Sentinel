import { NextRequest, NextResponse } from "next/server";
import { buildGraphData } from "@/lib/knowledge/graph";

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const roomId = searchParams.get("roomId") ?? undefined;
  const projectId = searchParams.get("projectId") ?? undefined;

  try {
    const graph = await buildGraphData({ roomId, projectId });
    return NextResponse.json(graph);
  } catch {
    // Return empty graph on DB error (DB may not be running in dev)
    return NextResponse.json({ nodes: [], edges: [] });
  }
}
