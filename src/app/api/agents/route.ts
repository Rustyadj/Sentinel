import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { ensureAgentsSeeded } from "@/lib/agents/seed";
import { syncAgentToGraph } from "@/lib/agents/graph";

export async function GET() {
  await ensureAgentsSeeded();
  const agents = await db.agent.findMany({
    include: { configuration: true },
    orderBy: { createdAt: "asc" },
  });
  return NextResponse.json(agents);
}

export async function POST(req: Request) {
  const body = (await req.json()) as {
    name: string; role: string; avatar: string; color: string;
    model?: string; systemPrompt?: string; toolPermissions?: string[];
    memoryScope?: string; description?: string; skills?: string[];
  };
  const agent = await db.agent.create({
    data: {
      name: body.name,
      role: body.role,
      avatar: body.avatar ?? "🤖",
      color: body.color ?? "#6366f1",
      description: body.description ?? "",
      skills: body.skills ?? [],
      configuration: {
        create: {
          model: body.model ?? "claude-sonnet-4-6",
          systemPrompt: body.systemPrompt ?? "",
          allowedTools: body.toolPermissions ?? [],
          memoryScope: body.memoryScope ?? "session",
        },
      },
    },
    include: { configuration: true },
  });
  await syncAgentToGraph(agent);
  return NextResponse.json(agent, { status: 201 });
}
