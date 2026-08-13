import { NextResponse } from "next/server";
import { requireUser } from "@/lib/current-user";
import { runEvalSuite } from "@/lib/learning/eval-compiler";

export async function POST(req: Request) {
  const user = await requireUser().catch(() => null);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json();
  if (!body.suiteId || !body.candidateId) {
    return NextResponse.json({ error: "suiteId and candidateId are required" }, { status: 400 });
  }
  try {
    const result = await runEvalSuite({ suiteId: body.suiteId, candidateId: body.candidateId, triggeredBy: `user:${user.id}` });
    return NextResponse.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Internal error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
