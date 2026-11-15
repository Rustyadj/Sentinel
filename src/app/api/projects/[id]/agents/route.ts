import { NextRequest, NextResponse } from "next/server";
import { requireProjectPermission } from "@/lib/workspaces/authorization";
import { projectAgentErrorResponse } from "@/lib/collaboration/http";
import { bringOutsideAgent, listProjectAgents } from "@/lib/collaboration/project-agents";

type Context = { params: Promise<{ id: string }> };

export async function GET(_req: NextRequest, { params }: Context) {
  try {
    const { id } = await params;
    const { user, project } = await requireProjectPermission(id, "project.read");
    return NextResponse.json({ agents: await listProjectAgents(project, user.id) });
  } catch (error) {
    return projectAgentErrorResponse(error);
  }
}

/** Bring an agent that runs on your own server. Anyone who may write to the project may; a viewer may not. */
export async function POST(req: NextRequest, { params }: Context) {
  try {
    const { id } = await params;
    const { user, project } = await requireProjectPermission(id, "project.update");
    const body = (await req.json().catch(() => null)) as { url?: unknown } | null;
    if (typeof body?.url !== "string" || !body.url.trim() || body.url.length > 2_000) {
      return NextResponse.json({ error: "The address of your agent, or of its Agent Card, is required." }, { status: 400 });
    }
    const { agent, token } = await bringOutsideAgent({ project, ownerUserId: user.id, url: body.url });
    return NextResponse.json({ agent, token }, { status: 201 });
  } catch (error) {
    return projectAgentErrorResponse(error);
  }
}
