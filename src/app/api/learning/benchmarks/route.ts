import { NextResponse } from "next/server";
import { requireUser } from "@/lib/current-user";
import { createBenchmarkDefinition, listBenchmarkDefinitions } from "@/lib/learning/benchmarks";
import {
  learningAccessErrorResponse,
  requireLearningWorkspaceAccess,
} from "@/lib/learning/authorization";

export async function GET(req: Request) {
  const user = await requireUser().catch(() => null);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const definitions = await listBenchmarkDefinitions({
    category: searchParams.get("category") ?? undefined,
  });
  return NextResponse.json(definitions);
}

export async function POST(req: Request) {
  const user = await requireUser().catch(() => null);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json();
  if (!body.name || !body.category || !body.scoringMethod || !body.workspaceId) {
    return NextResponse.json({ error: "name, category, scoringMethod, and workspaceId are required" }, { status: 400 });
  }
  try {
    await requireLearningWorkspaceAccess(user.id, body.workspaceId, "workspace.update");
    const definition = await createBenchmarkDefinition(body);
    return NextResponse.json(definition);
  } catch (error) {
    return learningAccessErrorResponse(error);
  }
}
