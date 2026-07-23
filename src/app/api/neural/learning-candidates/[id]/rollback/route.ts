import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/current-user";
import { rollbackCandidate } from "@/lib/neural-engine/learning-service";

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const user = await requireUser();
    const { id } = await params;
    const result = await rollbackCandidate(id, user.id);
    return NextResponse.json(result);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
