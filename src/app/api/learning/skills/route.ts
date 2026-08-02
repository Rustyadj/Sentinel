import { NextResponse } from "next/server";
import { requireUser } from "@/lib/current-user";
import { listSkillsForVersioning } from "@/lib/learning/skill-versions";

export async function GET() {
  const user = await requireUser().catch(() => null);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  return NextResponse.json(await listSkillsForVersioning());
}
