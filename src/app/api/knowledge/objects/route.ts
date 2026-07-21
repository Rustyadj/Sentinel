import { NextRequest, NextResponse } from "next/server";
import {
  createKnowledgeObject,
  listKnowledgeObjects,
} from "@/lib/knowledge/objects";
import type { KnowledgeObjectType, KnowledgeScope } from "@/lib/knowledge/types";
import { requireUser } from "@/lib/current-user";
import { requireProjectPermission, requireWorkspacePermission } from "@/lib/workspaces/authorization";

export async function GET(req: NextRequest) {
  try {
    const user = await requireUser();
    const { searchParams } = req.nextUrl;
    const projectId = searchParams.get("projectId") ?? undefined;
    const type = searchParams.get("type") as KnowledgeObjectType | undefined;
    const scope = searchParams.get("scope") as KnowledgeScope | undefined;

    if (projectId) {
      await requireProjectPermission(projectId, "project.read");
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
      await requireProjectPermission(projectId, "project.update");
    }
    if (workspaceId) await requireWorkspacePermission(workspaceId, "document.create");

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
