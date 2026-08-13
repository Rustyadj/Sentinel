import { NextResponse } from "next/server";
import { createSkill, listSkills } from "@/lib/learning-core/skills";

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  return NextResponse.json(await listSkills({
    status: searchParams.get("status") ?? undefined,
    approvalLevel: searchParams.get("approvalLevel") ? Number(searchParams.get("approvalLevel")) : undefined,
    limit: searchParams.get("limit") ? Number(searchParams.get("limit")) : undefined,
  }));
}

export async function POST(req: Request) {
  try {
    const body = await req.json();
    if (!body.name || !body.description) {
      return NextResponse.json({ error: "name and description are required" }, { status: 400 });
    }
    return NextResponse.json(await createSkill(body), { status: 201 });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Unable to create skill" }, { status: 400 });
  }
}
