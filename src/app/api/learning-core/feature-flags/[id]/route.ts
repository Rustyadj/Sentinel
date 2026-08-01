import { NextResponse } from "next/server";
import { deleteFeatureFlag, getFeatureFlag, updateFeatureFlag } from "@/lib/learning-core/feature-flags";

type Context = { params: Promise<{ id: string }> };

export async function GET(_req: Request, { params }: Context) {
  const { id } = await params;
  const row = await getFeatureFlag(id);
  return row ? NextResponse.json(row) : NextResponse.json({ error: "Not found" }, { status: 404 });
}

export async function PATCH(req: Request, { params }: Context) {
  try {
    const { id } = await params;
    return NextResponse.json(await updateFeatureFlag(id, await req.json()));
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Unable to update feature flag" }, { status: 400 });
  }
}

export async function DELETE(_req: Request, { params }: Context) {
  const { id } = await params;
  await deleteFeatureFlag(id);
  return new NextResponse(null, { status: 204 });
}
