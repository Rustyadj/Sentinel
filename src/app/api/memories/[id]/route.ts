import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/current-user";
import { requireMemoryAccess } from "@/lib/knowledge/memoryAccess";

type Params = { params: Promise<{ id: string }> };

export async function GET(_req: NextRequest, { params }: Params) {
  try {
    const user = await requireUser();
    const { id } = await params;
    if (!(await requireMemoryAccess(id, user.id))) return NextResponse.json({ error: "Not found" }, { status: 404 });
    const memory = await db.memory.findUnique({
      where: { id },
      select: {
        id: true, type: true, scope: true, owner: true, content: true,
        tags: true, confidence: true, importanceScore: true, source: true,
        pinned: true, archived: true, createdAt: true, updatedAt: true,
      },
    });
    if (!memory) return NextResponse.json({ error: "Not found" }, { status: 404 });
    return NextResponse.json(memory);
  } catch (err) {
    if (err instanceof Error && err.message === "Unauthorized") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("[GET /api/memories/[id]]", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function PATCH(request: NextRequest, { params }: Params) {
  try {
    const user = await requireUser();
    const { id } = await params;
    if (!(await requireMemoryAccess(id, user.id, true))) return NextResponse.json({ error: "Not found" }, { status: 404 });
    const body = await request.json() as Partial<{
      pinned: boolean;
      archived: boolean;
      content: string;
      tags: string[];
      confidence: number;
      importanceScore: number;
    }>;

    const data = {
      ...(typeof body.pinned === "boolean" ? { pinned: body.pinned } : {}),
      ...(typeof body.archived === "boolean" ? { archived: body.archived } : {}),
      ...(typeof body.content === "string" ? { content: body.content } : {}),
      ...(Array.isArray(body.tags) ? { tags: body.tags } : {}),
      ...(typeof body.confidence === "number" ? { confidence: body.confidence } : {}),
      ...(typeof body.importanceScore === "number" ? { importanceScore: body.importanceScore } : {}),
    };
    const memory = await db.memory.update({
      where: { id },
      data,
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

    return NextResponse.json(memory);
  } catch (err) {
    if (err instanceof Error && err.message === "Unauthorized") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("[PATCH /api/memories/[id]]", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function DELETE(_request: NextRequest, { params }: Params) {
  try {
    const user = await requireUser();
    const { id } = await params;
    if (!(await requireMemoryAccess(id, user.id, true))) return NextResponse.json({ error: "Not found" }, { status: 404 });

    await db.memory.delete({ where: { id } });

    return new NextResponse(null, { status: 204 });
  } catch (err) {
    if (err instanceof Error && err.message === "Unauthorized") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("[DELETE /api/memories/[id]]", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
