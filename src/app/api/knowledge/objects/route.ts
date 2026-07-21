import { NextRequest, NextResponse } from "next/server";
import {
  createKnowledgeObject,
  listKnowledgeObjects,
} from "@/lib/knowledge/objects";
import type { KnowledgeObjectType, KnowledgeScope } from "@/lib/knowledge/types";
import { requireUser } from "@/lib/current-user";
import { db } from "@/lib/db";

export async function GET(req: NextRequest) {
  try {
    const user = await requireUser();
    const { searchParams } = req.nextUrl;
    const projectId = searchParams.get("projectId") ?? undefined;
    const type = searchParams.get("type") as KnowledgeObjectType | undefined;
    const scope = searchParams.get("scope") as KnowledgeScope | undefined;

    if (projectId) {
      const project = await db.project.findFirst({ where: { id: projectId, userId: user.id }, select: { id: true } });
      if (!project) return NextResponse.json({ error: "Project not found" }, { status: 404 });
    }

    const objects = await listKnowledgeObjects({ userId: user.id, projectId, type, scope });
    return NextResponse.json({ objects });
  } catch {
    return NextResponse.json({ objects: [] });
  }
}

export async function POST(req: NextRequest) {
  try {
    const user = await requireUser();
    const body = await req.json();
    const { type, title, summary, sourceType, sourceId, scope, workspaceId, projectId, metadata } = body;

    if (!type || !title) {
      return NextResponse.json({ error: "Missing required fields: type, title" }, { status: 400 });
    }

    if (projectId) {
      const project = await db.project.findFirst({ where: { id: projectId, userId: user.id }, select: { id: true } });
      if (!project) return NextResponse.json({ error: "Project not found" }, { status: 404 });
    }

    const object = await createKnowledgeObject({
      userId: user.id,
      type: type as KnowledgeObjectType,
      title,
      summary,
      sourceType: sourceType ?? "api",
      sourceId: sourceId ?? "unknown",
      scope: scope as KnowledgeScope | undefined,
      workspaceId,
      projectId,
      metadata,
    });

    return NextResponse.json(object, { status: 201 });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Internal error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
