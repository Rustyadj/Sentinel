import { NextResponse } from "next/server";
import { requireUser } from "@/lib/current-user";
import { updateReflectionStatus } from "@/lib/learning/reflection";

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser().catch(() => null);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const body = await req.json();
  if (!["open", "actioned", "dismissed"].includes(body.status)) {
    return NextResponse.json({ error: "status must be open, actioned, or dismissed" }, { status: 400 });
  }
  const reflection = await updateReflectionStatus(id, body.status);
  return NextResponse.json(reflection);
}
