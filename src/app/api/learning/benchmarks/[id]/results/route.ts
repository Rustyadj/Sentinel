import { NextResponse } from "next/server";
import { requireUser } from "@/lib/current-user";
import { listBenchmarkResults, recordBenchmarkResult } from "@/lib/learning/benchmarks";

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser().catch(() => null);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const { searchParams } = new URL(req.url);
  const results = await listBenchmarkResults({
    benchmarkId: id,
    candidateId: searchParams.get("candidateId") ?? undefined,
  });
  return NextResponse.json(results);
}

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser().catch(() => null);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const body = await req.json();
  if (!body.metrics) {
    return NextResponse.json({ error: "metrics is required" }, { status: 400 });
  }
  const result = await recordBenchmarkResult({
    benchmarkId: id,
    candidateId: body.candidateId ?? null,
    agentId: body.agentId,
    version: body.version,
    metrics: body.metrics,
  });
  return NextResponse.json(result);
}
