import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/current-user";

export async function POST() {
  try {
    const user = await requireUser();
    const memories = await db.memory.findMany({
      where: { owner: user.id, archived: false },
      select: { id: true, content: true, type: true, scope: true, tags: true, confidence: true },
      orderBy: { createdAt: "desc" },
      take: 500,
    });

    const duplicatesFound: string[] = [];
    const seen = new Map<string, string>(); // normalized content → id

    for (const mem of memories) {
      const normalized = mem.content.toLowerCase().trim().slice(0, 100);
      const existingId = seen.get(normalized);
      if (existingId) {
        duplicatesFound.push(mem.id);
        await db.memory.update({
          where: { id: mem.id },
          data: { archived: true, tags: [...mem.tags, "duplicate"] },
        });
      } else {
        seen.set(normalized, mem.id);
      }
    }

    // Boost importance of pinned memories
    await db.memory.updateMany({
      where: { owner: user.id, pinned: true, archived: false },
      data: { importanceScore: 0.95 },
    });

    // Decay old low-confidence memories
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const old = await db.memory.findMany({
      where: { owner: user.id, archived: false, confidence: { lt: 0.4 }, createdAt: { lt: thirtyDaysAgo } },
      select: { id: true, confidence: true },
    });
    for (const m of old) {
      await db.memory.update({
        where: { id: m.id },
        data: { importanceScore: Math.max(0.1, m.confidence * 0.8) },
      });
    }

    return NextResponse.json({
      ok: true,
      duplicatesArchived: duplicatesFound.length,
      memoriesProcessed: memories.length,
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    if (err instanceof Error && err.message === "Unauthorized") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("[POST /api/memories/reflect]", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
