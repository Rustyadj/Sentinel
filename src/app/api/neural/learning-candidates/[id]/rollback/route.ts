import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/current-user";
import {
  learningAccessErrorResponse,
  requireLearningCandidateAccess,
} from "@/lib/learning/authorization";
import { rollbackCandidate } from "@/lib/neural-engine/learning-service";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const user = await requireUser();
    const { id } = await params;
    await requireLearningCandidateAccess(user.id, id, "workspace.update");
    const body = await req.json().catch(() => null);
    const reason = typeof body?.reason === "string" ? body.reason : undefined;
    const result = await rollbackCandidate(id, user.id, reason);
    return NextResponse.json(result);
  } catch (err) {
    return learningAccessErrorResponse(err);
  }
}
