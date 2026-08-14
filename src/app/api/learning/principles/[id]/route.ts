import { NextResponse } from "next/server";
import { requireUser } from "@/lib/current-user";
import { getPrincipleHistory, evolvePrinciple } from "@/lib/learning/principles";
import { db } from "@/lib/db";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser().catch(() => null);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const [principle, history] = await Promise.all([
    db.principle.findUnique({ where: { id } }),
    getPrincipleHistory(id),
  ]);
  if (!principle) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json({ principle, history });
}

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser().catch(() => null);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const body = await req.json();
  if (!body.changeReason) {
    return NextResponse.json({ error: "changeReason is required" }, { status: 400 });
  }
  try {
    const updated = await evolvePrinciple({ ...body, principleId: id, actorId: user.id });
    return NextResponse.json(updated);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Internal error";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
