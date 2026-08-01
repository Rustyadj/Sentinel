import { NextResponse } from "next/server";
import { requireUser } from "@/lib/current-user";
import { deleteSkill, getSkill, updateSkill } from "@/lib/learning-core/skills";

type Context = { params: Promise<{ id: string }> };

export async function GET(_req: Request, { params }: Context) {
  const { id } = await params;
  const row = await getSkill(id);
  return row ? NextResponse.json(row) : NextResponse.json({ error: "Not found" }, { status: 404 });
}

export async function PATCH(req: Request, { params }: Context) {
  try {
    const { id } = await params;
    const body = await req.json();
    const user = body.status === "approved" ? await requireUser() : undefined;
    return NextResponse.json(await updateSkill(id, body, { humanUserId: user?.id }));
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Unable to update skill" }, { status: 400 });
  }
}

export async function DELETE(_req: Request, { params }: Context) {
  const { id } = await params;
  await deleteSkill(id);
  return new NextResponse(null, { status: 204 });
}
