import { NextResponse } from "next/server";
import { runRecordedRoutineSweep } from "@/lib/neural-engine/scheduler-service";

// Same system-only secret boundary as the other externally triggered sweeps.
export async function POST(request: Request) {
  const secret = process.env.NEURAL_SWEEP_SECRET;
  if (!secret) return NextResponse.json({ error: "NEURAL_SWEEP_SECRET is not configured — sweep is disabled" }, { status: 503 });
  if (request.headers.get("authorization") !== `Bearer ${secret}`) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    const { jobRunId, result } = await runRecordedRoutineSweep();
    return NextResponse.json({ jobRunId, ...result });
  } catch (error) {
    console.error("[routine-scheduler]", error);
    return NextResponse.json({ error: "Routine sweep failed" }, { status: 500 });
  }
}
