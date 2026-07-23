import { NextRequest, NextResponse } from "next/server";
import { runDegradationSweep } from "@/lib/neural-engine/degradation-service";

/**
 * Sweep applied confidence_update LearningCandidates and roll back the ones
 * whose real Experience outcomes degraded after they were applied.
 *
 * This is a system/scheduler endpoint, not a user-facing one — there is no
 * in-process cron in this repo, so something external (Vercel Cron, a GitHub
 * Action on a schedule, an ops script) is expected to call this on an
 * interval, authenticated with NEURAL_SWEEP_SECRET. Fails closed: if the
 * secret isn't configured, the route refuses all requests rather than
 * running unauthenticated.
 */
export async function POST(req: NextRequest) {
  const configuredSecret = process.env.NEURAL_SWEEP_SECRET;
  if (!configuredSecret) {
    return NextResponse.json(
      { error: "NEURAL_SWEEP_SECRET is not configured — sweep is disabled" },
      { status: 503 },
    );
  }

  const provided = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  if (provided !== configuredSecret) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const result = await runDegradationSweep();
    return NextResponse.json(result);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
