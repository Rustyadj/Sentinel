import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/current-user";
import { deleteProject, updateProject } from "@/lib/workspaces";
import { accessErrorResponse, requireWorkspacePermission } from "@/lib/workspaces/authorization";

type Context = { params: Promise<{ id: string }> };

async function authorize(id: string, permission: string) {
  const project = await db.project.findUnique({ where: { id }, select: { userId: true, workspaceId: true } });
  if (!project) throw new Error("Project not found");
  const user = await requireUser();
  if (project.workspaceId) return requireWorkspacePermission(project.workspaceId, permission);
  if (project.userId !== user.id) throw new Error("Forbidden");
  return user;
}

export async function PATCH(req: NextRequest, { params }: Context) {
  try {
    const { id } = await params;
    const user = await authorize(id, "project.update");
    return NextResponse.json(await updateProject(id, await req.json(), user.id));
  } catch (error) {
    return accessErrorResponse(error);
  }
}

export async function DELETE(_req: NextRequest, { params }: Context) {
  try {
    const { id } = await params;
    const user = await authorize(id, "project.delete");
    await deleteProject(id, user.id);
    return new NextResponse(null, { status: 204 });
  } catch (error) {
    return accessErrorResponse(error);
  }
}
