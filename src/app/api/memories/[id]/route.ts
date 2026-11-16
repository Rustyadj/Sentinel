import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/current-user";
import { requireMemoryAccess } from "@/lib/knowledge/memoryAccess";
import { removeEntityFromGraph, syncMemoryToGraph } from "@/lib/knowledge/entity-sync";
import { deleteUserMemory, MemoryWriteDenied, updateUserMemory } from "@/lib/neural-engine/memory-write";

function deniedResponse(error: unknown) {
  return error instanceof MemoryWriteDenied
    ? NextResponse.json({ error: error.message, code: error.code }, { status: error.status })
    : null;
}

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
    const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
    if (!body || typeof body !== "object") return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
    const unit = (value: unknown) => typeof value === "number" && Number.isFinite(value) ? Math.min(Math.max(value, 0), 1) : undefined;

    const data = {
      ...(typeof body.pinned === "boolean" ? { pinned: body.pinned } : {}),
      ...(typeof body.archived === "boolean" ? { archived: body.archived } : {}),
      ...(typeof body.content === "string" && body.content.trim() ? { content: body.content.trim().slice(0, 10_000) } : {}),
      ...(Array.isArray(body.tags) ? { tags: body.tags.filter((tag): tag is string => typeof tag === "string").slice(0, 50) } : {}),
      ...(unit(body.confidence) !== undefined ? { confidence: unit(body.confidence) } : {}),
      ...(unit(body.importanceScore) !== undefined ? { importanceScore: unit(body.importanceScore) } : {}),
    };
    const memory = await updateUserMemory(user.id, id, data, {
      id: true, type: true, scope: true, owner: true, content: true, tags: true, confidence: true,
      importanceScore: true, source: true, pinned: true, archived: true, projectId: true, createdAt: true, updatedAt: true,
    });
    await syncMemoryToGraph(memory).catch((err) => console.error("[memories] graph sync failed (non-fatal):", err));

    return NextResponse.json(memory);
  } catch (err) {
    if (err instanceof Error && err.message === "Unauthorized") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const denied = deniedResponse(err);
    if (denied) return denied;
    console.error("[PATCH /api/memories/[id]]", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function DELETE(_request: NextRequest, { params }: Params) {
  try {
    const user = await requireUser();
    const { id } = await params;
    await deleteUserMemory(user.id, id);
    await removeEntityFromGraph("memory", id).catch((err) => console.error("[memories] graph removal failed (non-fatal):", err));

    return new NextResponse(null, { status: 204 });
  } catch (err) {
    if (err instanceof Error && err.message === "Unauthorized") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const denied = deniedResponse(err);
    if (denied) return denied;
    console.error("[DELETE /api/memories/[id]]", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
