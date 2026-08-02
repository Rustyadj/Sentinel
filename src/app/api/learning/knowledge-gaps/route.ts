import { NextResponse } from "next/server";
import { requireUser } from "@/lib/current-user";
import {
  detectKnowledgeGaps,
  listKnowledgeGaps,
} from "@/lib/learning/knowledge-gaps";

export async function GET(req: Request) {
  const user = await requireUser().catch(() => null);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const gaps = await listKnowledgeGaps({
    agentId: searchParams.get("agentId") ?? undefined,
    workspaceId: searchParams.get("workspaceId") ?? undefined,
    projectId: searchParams.get("projectId") ?? undefined,
    status: searchParams.get("status") ?? undefined,
    limit: searchParams.get("limit") ? Number(searchParams.get("limit")) : undefined,
  });
  return NextResponse.json(gaps);
}

export async function POST(req: Request) {
  const user = await requireUser().catch(() => null);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const gaps = await detectKnowledgeGaps({
    agentId: typeof body.agentId === "string" ? body.agentId : undefined,
    workspaceId: typeof body.workspaceId === "string" ? body.workspaceId : undefined,
    projectId: typeof body.projectId === "string" ? body.projectId : undefined,
  });
  return NextResponse.json(gaps);
}
