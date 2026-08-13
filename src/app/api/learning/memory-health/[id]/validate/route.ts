import { NextResponse } from "next/server";
import { requireUser } from "@/lib/current-user";
import { validateQuarantinedMemory } from "@/lib/learning/memory-governance";
import { db } from "@/lib/db";

export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser().catch(() => null);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const memory = await db.memory.findUnique({ where: { id }, select: { owner: true } });
  if (!memory || memory.owner !== user.id) return NextResponse.json({ error: "Not found" }, { status: 404 });

  try {
    const updated = await validateQuarantinedMemory({ memoryId: id, actorId: user.id });
    return NextResponse.json(updated);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Internal error";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
