import { NextResponse } from "next/server";
import { requireUser } from "@/lib/current-user";
import {
  createSkillVersion,
  listSkillVersions,
} from "@/lib/learning/skill-versions";

export async function GET(req: Request) {
  const user = await requireUser().catch(() => null);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const skillId = new URL(req.url).searchParams.get("skillId")?.trim();
  if (!skillId) {
    return NextResponse.json({ error: "skillId is required" }, { status: 400 });
  }

  try {
    return NextResponse.json(await listSkillVersions(skillId));
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
  if (!body?.skillId) {
    return NextResponse.json({ error: "skillId is required" }, { status: 400 });
  }

  try {
    const { skillId, ...input } = body;
    return NextResponse.json(await createSkillVersion(skillId, input), { status: 201 });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: 400 },
    );
  }
}
