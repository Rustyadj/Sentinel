import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/current-user";
import { decideDecision, getDecision } from "@/lib/knowledge/decisions";

type Params = { params: Promise<{ id: string }> };

export async function GET(_req: NextRequest, { params }: Params) {
  try {
    await requireUser();
    const { id } = await params;
    const decision = await getDecision(id);
    if (!decision) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    return NextResponse.json(decision);
  } catch (error) {
    if (error instanceof Error && error.message === "Unauthorized") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("[GET /api/decisions/:id]", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest, { params }: Params) {
  try {
    const user = await requireUser();
    const { id } = await params;
    const body = (await req.json()) as { status?: unknown; note?: unknown };
    if (body.status !== "approved" && body.status !== "rejected") {
      return NextResponse.json(
        { error: "status must be approved or rejected" },
        { status: 400 }
      );
    }
    if (body.note !== undefined && typeof body.note !== "string") {
      return NextResponse.json({ error: "note must be a string" }, { status: 400 });
    }

    const decision = await decideDecision(id, {
      status: body.status,
      decidedBy: user.id,
      note: typeof body.note === "string" && body.note.trim() ? body.note.trim() : undefined,
    });
    if (!decision) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    return NextResponse.json(decision);
  } catch (error) {
    if (error instanceof Error && error.message === "Unauthorized") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("[PATCH /api/decisions/:id]", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
