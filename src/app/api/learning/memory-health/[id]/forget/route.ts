import { NextResponse } from "next/server";
import { requireUser } from "@/lib/current-user";
import { forgetMemory } from "@/lib/learning/memory-governance";
import { db } from "@/lib/db";

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser().catch(() => null);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const memory = await db.memory.findUnique({ where: { id }, select: { owner: true } });
  if (!memory || memory.owner !== user.id) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const body = await req.json().catch(() => ({}));
  const updated = await forgetMemory({ memoryId: id, reason: body.reason ?? "manual forget", actorId: user.id });
  return NextResponse.json(updated);
}
