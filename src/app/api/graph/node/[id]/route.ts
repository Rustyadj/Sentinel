import { NextResponse } from "next/server";
import { requireUser } from "@/lib/current-user";
import { getNodeDetail } from "@/lib/graph/scoped";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireUser();
    const { id } = await params;
    return NextResponse.json(await getNodeDetail(user.id, id));
  } catch (error) {
    const message = error instanceof Error ? error.message : "Node query failed";
    const status = message === "Unauthorized" ? 401 : message.includes("not found") ? 404 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
