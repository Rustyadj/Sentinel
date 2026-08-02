import { NextResponse } from "next/server";
import { requireUser } from "@/lib/current-user";
import { activateSkillVersion } from "@/lib/learning/skill-versions";

export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await requireUser().catch(() => null);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    const { id } = await params;
    return NextResponse.json(
      await activateSkillVersion(id, { authorizedByUserId: user.id }),
    );
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: 400 },
    );
  }
}
