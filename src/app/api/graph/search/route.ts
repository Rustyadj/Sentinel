import { NextResponse, type NextRequest } from "next/server";
import { requireUser } from "@/lib/current-user";
import { searchGraphNodes } from "@/lib/graph/scoped";

export async function GET(request: NextRequest) {
  try {
    const user = await requireUser();
    const query = request.nextUrl.searchParams.get("q") ?? "";
    return NextResponse.json({ nodes: await searchGraphNodes(user.id, query) });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Search failed";
    return NextResponse.json({ error: message, nodes: [] }, { status: message === "Unauthorized" ? 401 : 500 });
  }
}
