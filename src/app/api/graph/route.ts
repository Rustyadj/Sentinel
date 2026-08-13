import { NextRequest, NextResponse } from "next/server";
import { buildGraphData } from "@/lib/knowledge/graph";
import { requireUser } from "@/lib/current-user";

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const roomId = searchParams.get("roomId") ?? undefined;
  const projectId = searchParams.get("projectId") ?? undefined;

  try {
    const user = await requireUser();
    const graph = await buildGraphData({ roomId, projectId }, user.id);
    return NextResponse.json({ ...graph, source: "postgres" });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Graph query failed";
    const status = message === "Unauthorized" ? 401 : message.includes("not found") ? 404 : 500;
    return NextResponse.json({ error: message, nodes: [], edges: [] }, { status });
  }
}
