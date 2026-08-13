import { NextResponse } from "next/server";
import { deleteBenchmark, getBenchmark } from "@/lib/learning-core/benchmarks";

type Context = { params: Promise<{ id: string }> };

export async function GET(_req: Request, { params }: Context) {
  const { id } = await params;
  const row = await getBenchmark(id);
  return row ? NextResponse.json(row) : NextResponse.json({ error: "Not found" }, { status: 404 });
}

export async function DELETE(_req: Request, { params }: Context) {
  const { id } = await params;
  await deleteBenchmark(id);
  return new NextResponse(null, { status: 204 });
}
