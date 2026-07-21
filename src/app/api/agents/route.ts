import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import {
  canEditConfig,
  getAccessibleWorkspaceIds,
  getControlPlaneUser,
  getWorkspaceControlPlaneUser,
  forbidden,
  unauthorized,
} from "@/lib/agents/permissions";

export async function GET() {
  const user = await getControlPlaneUser();
  if (!user) return unauthorized();
  const workspaceIds = await getAccessibleWorkspaceIds(user.id);
  const agents = await db.agent.findMany({
    where: { workspaceId: { in: workspaceIds } },
    orderBy: { createdAt: "asc" },
  });
  return NextResponse.json(agents);
}

export async function POST(req: Request) {
  const body = await req.json() as {
    workspaceId?: string; name?: string; role?: string; avatar?: string; color?: string;
    model?: string; systemPrompt?: string; toolPermissions?: string[];
    memoryScope?: string; description?: string; skills?: string[];
  };
  if (!body.workspaceId || !body.name?.trim() || !body.role?.trim()) {
    return NextResponse.json({ error: "workspaceId, name, and role are required" }, { status: 400 });
  }
  const user = await getWorkspaceControlPlaneUser(body.workspaceId);
  if (!user) return unauthorized();
  if (!canEditConfig(user.role)) return forbidden("create agents");

  const agent = await db.agent.create({
    data: {
      workspaceId: body.workspaceId,
      name: body.name.trim(),
      role: body.role.trim(),
      avatar: body.avatar ?? "AI",
      color: body.color ?? "#6366f1",
      model: body.model ?? "claude-sonnet-4-6",
      systemPrompt: body.systemPrompt ?? "",
      toolPermissions: body.toolPermissions ?? [],
      memoryScope: body.memoryScope ?? "session",
      description: body.description ?? "",
      skills: body.skills ?? [],
    },
  });
  return NextResponse.json(agent, { status: 201 });
}
