import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/current-user";
import { writeAuditLog } from "@/lib/workspaces/audit";
import { accessErrorResponse, requireWorkspacePermission } from "@/lib/workspaces/authorization";

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  try {
    const workspaceId = searchParams.get("workspaceId") ?? undefined;
    const projectId = searchParams.get("projectId") ?? undefined;
    if (workspaceId) await requireWorkspacePermission(workspaceId, "document.read");
    else await requireUser();
    const docs = await db.document.findMany({
      where: { ...(workspaceId ? { workspaceId } : {}), ...(projectId ? { projectId } : {}) },
      orderBy: [{ pinned: "desc" }, { updatedAt: "desc" }],
      select: { id: true, title: true, type: true, tags: true, pinned: true, version: true, workspaceId: true, projectId: true, createdAt: true, updatedAt: true },
    });
    return NextResponse.json(docs);
  } catch (error) {
    return accessErrorResponse(error);
  }
}

export async function POST(req: Request) {
  const body = await req.json() as { title: string; content?: string; type?: string; workspaceId?: string; projectId?: string; tags?: string[] };
  try {
    if (!body.title?.trim()) return NextResponse.json({ error: "title is required" }, { status: 400 });
    const user = body.workspaceId
      ? await requireWorkspacePermission(body.workspaceId, "document.create")
      : await requireUser();
    const doc = await db.document.create({
      data: {
        title: body.title,
        content: body.content ?? "",
        type: body.type ?? "markdown",
        workspaceId: body.workspaceId ?? null,
        projectId: body.projectId ?? null,
        tags: body.tags ?? [],
      },
    });
    await writeAuditLog({ workspaceId: doc.workspaceId, projectId: doc.projectId, userId: user.id, action: "document.created", entityType: "document", entityId: doc.id, details: { title: doc.title, type: doc.type } });
    return NextResponse.json(doc, { status: 201 });
  } catch (error) {
    return accessErrorResponse(error);
  }
}
