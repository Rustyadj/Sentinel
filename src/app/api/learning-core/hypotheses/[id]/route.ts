import { NextResponse } from "next/server";
import { requireUser } from "@/lib/current-user";
import { deleteHypothesis, getHypothesis, updateHypothesis } from "@/lib/learning-core/hypotheses";

type Context = { params: Promise<{ id: string }> };

export async function GET(_req: Request, { params }: Context) {
  const { id } = await params;
  const row = await getHypothesis(id);
  return row ? NextResponse.json(row) : NextResponse.json({ error: "Not found" }, { status: 404 });
}

export async function PATCH(req: Request, { params }: Context) {
  try {
    const { id } = await params;
    const body = await req.json();
    const user = body.status === "validated" ? await requireUser() : undefined;
    return NextResponse.json(await updateHypothesis(id, body, { humanUserId: user?.id }));
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Unable to update hypothesis" }, { status: 400 });
  }
}

export async function DELETE(_req: Request, { params }: Context) {
  const { id } = await params;
  await deleteHypothesis(id);
  return new NextResponse(null, { status: 204 });
}
