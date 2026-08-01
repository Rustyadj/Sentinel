import { NextResponse } from "next/server";
import { runReplay } from "@/lib/learning-core/replay";

// On-demand stand-in for the nightly scheduled replay — see runReplay()'s
// doc comment. Triggered from the Experience Replay page's "Run now" button.
export async function POST() {
  const result = await runReplay();
  return NextResponse.json(result);
}
