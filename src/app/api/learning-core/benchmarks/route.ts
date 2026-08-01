import { NextResponse } from "next/server";
import { createBenchmark, listBenchmarks } from "@/lib/learning-core/benchmarks";

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  return NextResponse.json(await listBenchmarks({
    experimentId: searchParams.get("experimentId") ?? undefined,
    metric: searchParams.get("metric") ?? undefined,
    limit: searchParams.get("limit") ? Number(searchParams.get("limit")) : undefined,
  }));
}

export async function POST(req: Request) {
  try {
    const body = await req.json();
    if (!body.name || !body.metric || typeof body.value !== "number") {
      return NextResponse.json({ error: "name, metric, and numeric value are required" }, { status: 400 });
    }
    return NextResponse.json(await createBenchmark(body), { status: 201 });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Unable to create benchmark" }, { status: 400 });
  }
}
