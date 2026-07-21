import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/current-user";
import { createWorkspace, listWorkspaces } from "@/lib/workspaces";
import { accessErrorResponse } from "@/lib/workspaces/authorization";

export async function GET() {
  try {
    const user = await requireUser();
    return NextResponse.json({ workspaces: await listWorkspaces(user.id) });
  } catch (error) {
    return accessErrorResponse(error);
  }
}

export async function POST(req: NextRequest) {
  try {
    const user = await requireUser();
    const body = (await req.json()) as {
      slug?: string;
      name?: string;
      description?: string;
      kind?: string;
      color?: string;
      icon?: string;
    };
    if (!body.slug?.trim() || !body.name?.trim()) {
      return NextResponse.json({ error: "Missing required fields: slug, name" }, { status: 400 });
    }
    const workspace = await createWorkspace(
      { ...body, slug: body.slug.trim().toLowerCase(), name: body.name.trim() },
      user.id
    );
    return NextResponse.json(workspace, { status: 201 });
  } catch (error) {
    return accessErrorResponse(error);
  }
}
