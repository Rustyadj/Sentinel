import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/current-user";

export async function GET() {
  try {
    await requireUser();

    const memories = await db.memory.findMany({
      where: { archived: false },
      orderBy: [{ pinned: "desc" }, { importanceScore: "desc" }, { createdAt: "desc" }],
      select: {
        id: true,
        type: true,
        scope: true,
        owner: true,
        content: true,
        tags: true,
        confidence: true,
        importanceScore: true,
        source: true,
        pinned: true,
        archived: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    return NextResponse.json(memories);
  } catch (err) {
    if (err instanceof Error && err.message === "Unauthorized") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("[GET /api/memories]", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    await requireUser();
    const body = await request.json() as {
      type: string;
      scope: string;
      owner: string;
      content: string;
      tags?: string[];
      confidence?: number;
      importanceScore?: number;
      source: string;
    };

    const { type, scope, owner, content, tags = [], confidence = 1.0, importanceScore = 0.5, source } = body;

    if (!type || !scope || !owner || !content || !source) {
      return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
    }

    const memory = await db.memory.create({
      data: { type, scope, owner, content, tags, confidence, importanceScore, source },
      select: {
        id: true,
        type: true,
        scope: true,
        owner: true,
        content: true,
        tags: true,
        confidence: true,
        importanceScore: true,
        source: true,
        pinned: true,
        archived: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    return NextResponse.json(memory, { status: 201 });
  } catch (err) {
    if (err instanceof Error && err.message === "Unauthorized") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("[POST /api/memories]", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
