import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/current-user";
import { reviewCandidate } from "@/lib/neural-engine/learning-service";

/**
 * Human approval gate for consequential graph changes. `decision` must be
 * "approve" or "reject" — the reviewer is always the authenticated user,
 * never inferred from the request body.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const user = await requireUser();
    const { id } = await params;
    const body = await req.json();
    if (body?.decision !== "approve" && body?.decision !== "reject") {
      return NextResponse.json(
        { error: 'decision must be "approve" or "reject"' },
        { status: 400 },
      );
    }
    const result = await reviewCandidate(id, body.decision, user.id);
    return NextResponse.json(result);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
