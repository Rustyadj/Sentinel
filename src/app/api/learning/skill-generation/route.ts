import { NextResponse } from "next/server";
import { requireUser } from "@/lib/current-user";
import {
  detectSkillOpportunity,
  listSkillGenerationProposals,
  proposeSkillFromPattern,
  runSkillGenerationPipeline,
} from "@/lib/learning/skill-generation";

export async function GET(req: Request) {
  const user = await requireUser().catch(() => null);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const sinceValue = searchParams.get("since");
  const since = sinceValue ? new Date(sinceValue) : undefined;
  if (since && Number.isNaN(since.getTime())) {
    return NextResponse.json({ error: "since must be a valid date" }, { status: 400 });
  }

  try {
    const [opportunities, proposals] = await Promise.all([
      detectSkillOpportunity({
        agentId: searchParams.get("agentId") ?? undefined,
        workspaceId: searchParams.get("workspaceId") ?? undefined,
        projectId: searchParams.get("projectId") ?? undefined,
        since,
      }),
      listSkillGenerationProposals(),
    ]);
    return NextResponse.json({ opportunities, proposals });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: 400 },
    );
  }
}

export async function POST(req: Request) {
  const user = await requireUser().catch(() => null);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json();
  try {
    if (body?.action === "propose") {
      return NextResponse.json(await proposeSkillFromPattern(body.input), { status: 201 });
    }
    if (body?.action === "run") {
      return NextResponse.json(await runSkillGenerationPipeline(body.input));
    }
    return NextResponse.json(
      { error: 'action must be "propose" or "run"' },
      { status: 400 },
    );
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: 400 },
    );
  }
}
