import { NextResponse } from "next/server";
import { requireUser } from "@/lib/current-user";
import { decideImprovement, listImprovementQueue } from "@/lib/learning-core/feature-flags";

export async function GET() {
  return NextResponse.json(await listImprovementQueue());
}

export async function POST(req: Request) {
  try {
    const body = await req.json();
    if (!body.type || !body.id || !["approve", "reject"].includes(body.decision)) {
      return NextResponse.json({ error: "type, id, and approve/reject decision are required" }, { status: 400 });
    }
    const user = await requireUser();
    return NextResponse.json(await decideImprovement({ ...body, humanUserId: user.id }));
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to decide improvement";
    return NextResponse.json({ error: message }, { status: message === "Unauthorized" ? 401 : 400 });
  }
}
