import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { writeAuditLog } from "@/lib/workspaces/audit";
import { accessErrorResponse, requireProjectPermission, requireWorkspacePermission, WorkspaceAccessError } from "@/lib/workspaces/authorization";

async function authorizeScope(workspaceId: string | undefined, projectId: string | undefined, permission: string) {
  if (projectId) {
    const access = await requireProjectPermission(projectId, permission);
    if (workspaceId && access.project.workspaceId !== workspaceId) throw new WorkspaceAccessError("Project scope mismatch", 400);
    return access.user;
  }
  if (workspaceId) return requireWorkspacePermission(workspaceId, permission);
  throw new WorkspaceAccessError("workspaceId or projectId is required", 400);
}

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  try {
    const workspaceId = searchParams.get("workspaceId") ?? undefined;
    const projectId = searchParams.get("projectId") ?? undefined;
    await authorizeScope(workspaceId, projectId, "document.read");
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
    const user = await authorizeScope(body.workspaceId, body.projectId, "document.create");
    const project = body.projectId
      ? await db.project.findUnique({ where: { id: body.projectId }, select: { workspaceId: true } })
      : null;
    const doc = await db.document.create({
      data: {
        title: body.title,
        content: body.content ?? "",
        type: body.type ?? "markdown",
        workspaceId: body.workspaceId ?? project?.workspaceId ?? null,
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
