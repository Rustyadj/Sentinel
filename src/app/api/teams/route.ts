import { NextRequest, NextResponse } from "next/server";
import { createTeam, listTeams } from "@/lib/workspaces";
import { accessErrorResponse, requireWorkspacePermission } from "@/lib/workspaces/authorization";

export async function GET(req: NextRequest) {
  try {
    const workspaceId = req.nextUrl.searchParams.get("workspaceId");
    if (!workspaceId) return NextResponse.json({ error: "workspaceId is required" }, { status: 400 });
    await requireWorkspacePermission(workspaceId, "team.read");
    return NextResponse.json({ teams: await listTeams(workspaceId) });
  } catch (error) {
    return accessErrorResponse(error);
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    if (!body.workspaceId || !body.name?.trim()) {
      return NextResponse.json({ error: "Missing required fields: workspaceId, name" }, { status: 400 });
    }
    const user = await requireWorkspacePermission(body.workspaceId, "team.create");
    return NextResponse.json(await createTeam(body, user.id), { status: 201 });
  } catch (error) {
    return accessErrorResponse(error);
  }
}
