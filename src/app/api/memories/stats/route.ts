import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/current-user";
import { memoryReadWhere } from "@/lib/knowledge/memoryAccess";

export async function GET() {
  try {
    const user = await requireUser();
    const access = await memoryReadWhere(user.id);
    const [total, pinned, archived, byScope, byType] = await Promise.all([
      db.memory.count({ where: { AND: [access], archived: false } }),
      db.memory.count({ where: { AND: [access], pinned: true, archived: false } }),
      db.memory.count({ where: { AND: [access], archived: true } }),
      db.memory.groupBy({ by: ["scope"], where: { AND: [access], archived: false }, _count: { id: true } }),
      db.memory.groupBy({ by: ["type"], where: { AND: [access], archived: false }, _count: { id: true } }),
    ]);
    return NextResponse.json({ total, pinned, archived, byScope, byType });
  } catch (err) {
    if (err instanceof Error && err.message === "Unauthorized") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("[GET /api/memories/stats]", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
