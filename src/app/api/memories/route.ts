import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/current-user";
import { memoryReadWhere } from "@/lib/knowledge/memoryAccess";
import { requireProjectPermission } from "@/lib/workspaces/authorization";
import { proposeMemoryCandidate } from "@/lib/adaptive-memory/memory-candidate-service";
import { MEMORY_CANDIDATE_TYPES, type MemoryCandidateType } from "@/lib/adaptive-memory/types";

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
  if (projectId) await requireProjectPermission(projectId, "project.read");
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
  const body = await req.json() as {
    type?: string; scope?: string; content?: string; tags?: string[]; projectId?: string;
    confidence?: number; importanceScore?: number; source?: string;
  };
  if (!body.type || !body.scope || !body.content || !body.source) return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
  if (body.scope === "project") {
    if (!body.projectId) return NextResponse.json({ error: "projectId is required" }, { status: 400 });
    await requireProjectPermission(body.projectId, "project.update");
  } else if (body.projectId) {
    return NextResponse.json({ error: "Only project-scoped memories may set projectId" }, { status: 400 });
  }
  if (["workspace", "organization", "org", "public"].includes(body.scope)) {
    return NextResponse.json({ error: "This scope requires a workspace-aware memory model" }, { status: 400 });
  }
  const candidateType = MEMORY_CANDIDATE_TYPES.includes(body.type as MemoryCandidateType)
    ? body.type as MemoryCandidateType : "fact";
  const candidate = await proposeMemoryCandidate({
    projectId: body.scope === "project" ? body.projectId : undefined,
    userId: body.scope === "project" ? undefined : user.id,
    candidateType, content: body.content,
    structuredPayload: { legacyTags: body.tags ?? [], legacyType: body.type },
    sourceType: "explicit_user_statement", sourceTrust: 0.95,
    confidence: body.confidence ?? 0.9, importance: body.importanceScore ?? 0.5,
    risk: 0.2, provenance: { sourceIds: [body.source], evidenceIds: [body.source], capturedAt: new Date().toISOString() },
    proposedBy: user.id,
  }, user.id);
  return NextResponse.json({ candidate, canonicalWrite: "admission_firewall" }, { status: 201 });
}
