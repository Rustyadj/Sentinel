import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/current-user";
import { memoryReadWhere } from "@/lib/knowledge/memoryAccess";
import { syncMemoryToGraph } from "@/lib/knowledge/entity-sync";
import { accessErrorResponse, requireProjectPermission, WorkspaceAccessError } from "@/lib/workspaces/authorization";
import { createUserMemory, MemoryWriteDenied } from "@/lib/neural-engine/memory-write";

const SELECT = {
  id: true, type: true, scope: true, owner: true, content: true, tags: true,
  confidence: true, importanceScore: true, source: true, pinned: true,
  archived: true, projectId: true, createdAt: true, updatedAt: true,
} as const;

export async function GET(req: NextRequest) {
  const user = await requireUser().catch(() => null);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { searchParams } = req.nextUrl;
  const projectId = searchParams.get("projectId") ?? undefined;
  if (projectId) {
    try { await requireProjectPermission(projectId, "project.read"); }
    catch (error) { if (error instanceof WorkspaceAccessError) return accessErrorResponse(error); throw error; }
  }
  const rawLimit = Number.parseInt(searchParams.get("limit") ?? "100", 10);
  const limit = Number.isFinite(rawLimit) ? Math.min(Math.max(rawLimit, 1), 500) : 100;
  const access = await memoryReadWhere(user.id);
  const search = searchParams.get("q")?.slice(0, 200);
  const memories = await db.memory.findMany({
    where: {
      AND: [
        access,
        ...(projectId ? [{ projectId, scope: "project" }] : []),
        ...(searchParams.get("scope") ? [{ scope: searchParams.get("scope")! }] : []),
        ...(searchParams.get("type") ? [{ type: searchParams.get("type")! }] : []),
        ...(search ? [{ OR: [
          { content: { contains: search, mode: "insensitive" as const } },
          { source: { contains: search, mode: "insensitive" as const } },
          { tags: { has: search } },
        ] }] : []),
      ],
      archived: searchParams.get("archived") === "true",
      ...(searchParams.get("pinned") === "true" ? { pinned: true } : {}),
    },
    orderBy: [{ pinned: "desc" }, { importanceScore: "desc" }, { createdAt: "desc" }],
    take: limit,
    select: SELECT,
  });
  return NextResponse.json(memories);
}

export async function POST(req: NextRequest) {
  const user = await requireUser().catch(() => null);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body || typeof body !== "object") return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  const str = (key: string) => (typeof body[key] === "string" ? (body[key] as string).trim() : "");
  const num = (key: string) => (typeof body[key] === "number" && Number.isFinite(body[key]) ? Math.min(Math.max(body[key] as number, 0), 1) : undefined);
  const type = str("type"), scope = str("scope"), content = str("content"), source = str("source");
  if (!type || !scope || !content || !source) return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
  if (content.length > 10_000) return NextResponse.json({ error: "content is too long" }, { status: 400 });
  // Personal and project memory only. Workspace, organization and public
  // memory are written by the workspace-aware paths, never named by a body.
  if (scope !== "user" && scope !== "project") {
    return NextResponse.json({ error: "This scope requires a workspace-aware memory model" }, { status: 400 });
  }
  const projectId = str("projectId") || null;
  if (scope === "project" && !projectId) return NextResponse.json({ error: "projectId is required" }, { status: 400 });
  if (scope !== "project" && projectId) return NextResponse.json({ error: "Only project-scoped memories may set projectId" }, { status: 400 });
  const tags = Array.isArray(body.tags) ? body.tags.filter((tag): tag is string => typeof tag === "string").slice(0, 50) : [];

  try {
    const memory = await createUserMemory(user.id, {
      type, scope, content, source, tags, projectId,
      confidence: num("confidence"), importanceScore: num("importanceScore"),
    }, SELECT);
    await syncMemoryToGraph(memory).catch((err) => console.error("[memories] graph sync failed (non-fatal):", err));
    return NextResponse.json(memory, { status: 201 });
  } catch (error) {
    if (error instanceof MemoryWriteDenied) return NextResponse.json({ error: error.message, code: error.code }, { status: error.status });
    throw error;
  }
}
