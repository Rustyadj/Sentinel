import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/current-user";
import { autoEvaluateExperience } from "@/lib/neural-engine/evaluator";
import { requireExperienceAccess, learningAccessErrorResponse } from "@/lib/learning/authorization";

/**
 * Run the deterministic auto-evaluator against a completed experience.
 * Normally invoked automatically by chat-capture, but exposed so an external
 * evaluator/scheduler (or a re-evaluation) can trigger it on demand.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const user = await requireUser();
    const { id } = await params;
    await requireExperienceAccess(user.id, id, "workspace.update");
    const body = await req.json().catch(() => ({}));
    const result = await autoEvaluateExperience(id, body?.evaluatorAgentId ?? null);
    return NextResponse.json(result, { status: 201 });
  } catch (err) {
    return learningAccessErrorResponse(err);
  }
}
