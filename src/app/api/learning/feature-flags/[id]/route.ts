import { NextResponse } from "next/server";
import { requireUser } from "@/lib/current-user";
import { updateFeatureFlag } from "@/lib/learning/feature-flags";

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await requireUser().catch(() => null);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const body = await req.json();
  try {
    return NextResponse.json(await updateFeatureFlag(id, body));
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: 400 },
    );
  }
}
