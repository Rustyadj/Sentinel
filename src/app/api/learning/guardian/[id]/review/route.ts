import { NextResponse } from "next/server";
import { requireUser } from "@/lib/current-user";
import { resolveGuardianReview } from "@/lib/learning/guardian";

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser().catch(() => null);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const body = await req.json();
  if (typeof body.approve !== "boolean") {
    return NextResponse.json({ error: "approve (boolean) is required" }, { status: 400 });
  }
  try {
    const decision = await resolveGuardianReview({
      decisionId: id,
      reviewerId: user.id,
      approve: body.approve,
      notes: body.notes,
    });
    return NextResponse.json(decision);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Internal error";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
