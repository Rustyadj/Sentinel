import { NextResponse } from "next/server";
import { generateKnowledgeGraph } from "@/lib/knowledge-graph/generate";
import { projectKnowledgeGraph } from "@/lib/knowledge-graph/project";
import type { KnowledgeGraph } from "@/lib/knowledge-graph/types";

/** Below this many objects the DB graph is too sparse to read as a galaxy. */
const MIN_DENSE_OBJECTS = 48;

/**
 * GET /api/knowledge/graph
 *
 * Returns the canonical KnowledgeGraph the Neural Space visualizes. Prefers the
 * DB projection; if the projection is empty/sparse (fresh install, or schema
 * drift), falls back to deterministic sample data so the space is always dense.
 * The renderer treats whatever comes back as read-only.
 */
export async function GET() {
  let graph: KnowledgeGraph;
  try {
    graph = await projectKnowledgeGraph();
    if (graph.objects.length < MIN_DENSE_OBJECTS) {
      graph = generateKnowledgeGraph();
    }
  } catch (err) {
    console.error("[knowledge/graph] projection failed, using sample:", err);
    graph = generateKnowledgeGraph();
  }

  return NextResponse.json(graph, {
    headers: { "Cache-Control": "no-store" },
  });
}
