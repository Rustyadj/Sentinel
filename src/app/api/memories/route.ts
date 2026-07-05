import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/current-user";

// ─── Memory scope isolation ───────────────────────────────────────────────────
// Rules:
//   session   → only the requesting user's own session memories
//   user      → only the requesting user's own memories
//   project   → only if projectId matches requested owner param
//   workspace → only workspace members (currently: all authenticated users)
//   org       → all authenticated users
//   agent     → all authenticated users (agent's own scope)
//   public    → all authenticated users

const GLOBAL_SCOPES = new Set(["org", "workspace", "public", "agent"]);

function buildScopeFilter(
  scope: string | null,
  userId: string,
  requestedOwner: string | null
): Record<string, unknown> {
  if (!scope) {
    // No scope filter — return records visible to this user
    return {
      OR: [
        { scope: { in: [...GLOBAL_SCOPES] } },
        { owner: userId },
        { owner: requestedOwner ?? undefined },
      ],
    };
  }

  if (GLOBAL_SCOPES.has(scope)) {
    return { scope };
  }

  // session and user scope: enforce owner = current user only
  if (scope === "session" || scope === "user") {
    return { scope, owner: userId };
  }

  // project scope: allow if requesting own owner or if no owner filter
  if (scope === "project") {
    if (requestedOwner && requestedOwner !== userId) {
      // Allow querying project memories by agent id or project id (not another user)
      return { scope, owner: requestedOwner };
    }
    return { scope };
  }

  return { scope };
}

export async function GET(req: NextRequest) {
  try {
    const user = await requireUser();
    const { searchParams } = new URL(req.url);
    const scope = searchParams.get("scope");
    const type = searchParams.get("type");
    const owner = searchParams.get("owner");
    const pinned = searchParams.get("pinned");
    const archived = searchParams.get("archived") === "true";
    const search = searchParams.get("q");
    const limit = Math.min(parseInt(searchParams.get("limit") ?? "100"), 500);

    const scopeFilter = buildScopeFilter(scope, user.id, owner);

    const memories = await db.memory.findMany({
      where: {
        archived,
        ...scopeFilter,
        ...(type ? { type } : {}),
        ...(pinned === "true" ? { pinned: true } : {}),
        ...(search ? {
          OR: [
            { content: { contains: search, mode: "insensitive" } },
            { source: { contains: search, mode: "insensitive" } },
            { tags: { has: search } },
          ],
        } : {}),
      },
      orderBy: [{ pinned: "desc" }, { importanceScore: "desc" }, { createdAt: "desc" }],
      take: limit,
      select: {
        id: true, type: true, scope: true, owner: true, content: true,
        tags: true, confidence: true, importanceScore: true, source: true,
        pinned: true, archived: true, createdAt: true, updatedAt: true,
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

export async function POST(req: NextRequest) {
  try {
    const user = await requireUser();
    const body = await req.json() as {
      type: string; scope: string; owner: string;
      content: string; tags?: string[]; projectId?: string;
      confidence?: number; importanceScore?: number; source: string;
    };
    const { type, scope, owner, content, tags = [], projectId, confidence = 1.0, importanceScore = 0.5, source } = body;
    if (!type || !scope || !owner || !content || !source) {
      return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
    }

    // Enforce: session/user scope memories must be owned by the current user
    if ((scope === "session" || scope === "user") && owner !== user.id) {
      return NextResponse.json({ error: "Cannot create session/user memory for another user" }, { status: 403 });
    }

    // Enforce: project-scoped memories must declare which project they belong to
    if (scope === "project" && !projectId) {
      return NextResponse.json({ error: "projectId is required for project-scoped memories" }, { status: 400 });
    }

    const memory = await db.memory.create({
      data: { type, scope, owner, content, tags, confidence, importanceScore, source, projectId: scope === "project" ? projectId : null },
      select: {
        id: true, type: true, scope: true, owner: true, content: true,
        tags: true, confidence: true, importanceScore: true, source: true,
        pinned: true, archived: true, createdAt: true, updatedAt: true,
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
