import { NextResponse } from "next/server";
import { resolveCuriosityEvent } from "@/lib/learning-core/curiosity";

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = await req.json();
  if (!body.resolution) {
    return NextResponse.json({ error: "resolution is required" }, { status: 400 });
  }
  const event = await resolveCuriosityEvent(id, body.resolution);
  return NextResponse.json(event);
}
