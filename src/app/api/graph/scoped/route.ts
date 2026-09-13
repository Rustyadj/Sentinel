import { NextResponse, type NextRequest } from "next/server";
import { requireUser } from "@/lib/current-user";
import { getScopedGraph } from "@/lib/graph/scoped";
import type { KnowledgeObjectType } from "@/lib/knowledge/types";

/** Bounded graph read. There is deliberately no "everything" mode. */
export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  try {
    const user = await requireUser();
    const sinceParam = params.get("since");
    const since = sinceParam ? new Date(sinceParam) : undefined;
    const graph = await getScopedGraph({
      userId: user.id,
      focusId: params.get("focus") ?? undefined,
      depth: params.get("depth") ? Number.parseInt(params.get("depth")!, 10) : undefined,
      limit: params.get("limit") ? Number.parseInt(params.get("limit")!, 10) : undefined,
      types: params.get("types")?.split(",").filter(Boolean) as KnowledgeObjectType[] | undefined,
      since: since && !Number.isNaN(since.getTime()) ? since : undefined,
      projectId: params.get("projectId") ?? undefined,
    });
    return NextResponse.json(graph);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Graph query failed";
    const status = message === "Unauthorized" ? 401 : message.includes("not found") ? 404 : 500;
    return NextResponse.json({ error: message, nodes: [], edges: [], focusId: null, partial: false, totalVisible: 0 }, { status });
  }
}
