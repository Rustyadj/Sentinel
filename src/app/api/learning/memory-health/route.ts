import { NextResponse } from "next/server";
import { requireUser } from "@/lib/current-user";
import { db } from "@/lib/db";

export async function GET(req: Request) {
  const user = await requireUser().catch(() => null);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const state = searchParams.get("state") ?? undefined;

  const [memories, stateCounts] = await Promise.all([
    db.memory.findMany({
      where: { owner: user.id, ...(state ? { state } : {}) },
      orderBy: [{ updatedAt: "desc" }],
      take: 200,
    }),
    db.memory.groupBy({ by: ["state"], where: { owner: user.id }, _count: { _all: true } }),
  ]);

  return NextResponse.json({
    memories,
    stateCounts: Object.fromEntries(stateCounts.map((s) => [s.state, s._count._all])),
  });
}
