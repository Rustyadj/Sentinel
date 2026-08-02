import { NextRequest, NextResponse } from "next/server";
import { runRecordedDegradationSweep } from "@/lib/neural-engine/scheduler-service";

/**
 * External scheduler boundary. A VPS cron or scheduled CI job calls this with
 * `Authorization: Bearer <NEURAL_SWEEP_SECRET>`; no timer lives in the app.
 */
export async function POST(req: NextRequest) {
  const configuredSecret = process.env.NEURAL_SWEEP_SECRET;
  if (!configuredSecret) {
    return NextResponse.json(
      { error: "NEURAL_SWEEP_SECRET is not configured — sweep is disabled" },
      { status: 503 },
    );
  }

  if (req.headers.get("authorization") !== `Bearer ${configuredSecret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const { jobRunId, result } = await runRecordedDegradationSweep();
    return NextResponse.json({ jobRunId, ...result });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: 500 },
    );
  }
}
