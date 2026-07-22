import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/current-user";
import { autoEvaluateExperience } from "@/lib/neural-engine/evaluator";

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
    await requireUser();
    const { id } = await params;
    const body = await req.json().catch(() => ({}));
    const result = await autoEvaluateExperience(id, body?.evaluatorAgentId ?? null);
    return NextResponse.json(result, { status: 201 });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
