import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/current-user";
import { reviewCandidate } from "@/lib/neural-engine/learning-service";
import { requireLearningCandidateAccess, learningAccessErrorResponse } from "@/lib/learning/authorization";

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
    await requireLearningCandidateAccess(user.id, id, "workspace.update");
    const reason = typeof body.reason === "string" ? body.reason : undefined;
    const result = await reviewCandidate(id, body.decision, user.id, reason);
    return NextResponse.json(result);
  } catch (err) {
    return learningAccessErrorResponse(err);
  }
}
