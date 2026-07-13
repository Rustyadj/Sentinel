import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/current-user";
import { createProject, listProjects } from "@/lib/workspaces";
import { accessErrorResponse, requireWorkspacePermission } from "@/lib/workspaces/authorization";

export async function GET(req: NextRequest) {
  try {
    const user = await requireUser();
    const workspaceId = req.nextUrl.searchParams.get("workspaceId") ?? undefined;
    if (workspaceId) await requireWorkspacePermission(workspaceId, "project.read");
    const projects = await listProjects(workspaceId ? { workspaceId } : { userId: user.id });
    return NextResponse.json({ projects });
  } catch (error) {
    return accessErrorResponse(error);
  }
}

export async function POST(req: NextRequest) {
  try {
    const user = await requireUser();
    const body = await req.json();
    if (!body.name?.trim()) return NextResponse.json({ error: "Missing required field: name" }, { status: 400 });
    if (body.workspaceId) await requireWorkspacePermission(body.workspaceId, "project.create");
    return NextResponse.json(await createProject(body, user.id), { status: 201 });
  } catch (error) {
    return accessErrorResponse(error);
  }
}
