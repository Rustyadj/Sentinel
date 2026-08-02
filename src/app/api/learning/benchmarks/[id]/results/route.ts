import { NextResponse } from "next/server";
import { requireUser } from "@/lib/current-user";
import { listBenchmarkResults, recordBenchmarkResult } from "@/lib/learning/benchmarks";
import {
  learningAccessErrorResponse,
  requireBenchmarkAccess,
  requireLearningCandidateAccess,
} from "@/lib/learning/authorization";

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser().catch(() => null);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  try {
    await requireBenchmarkAccess(user.id, id, "workspace.read");
    const { searchParams } = new URL(req.url);
    const candidateId = searchParams.get("candidateId") ?? undefined;
    if (candidateId) {
      await requireLearningCandidateAccess(user.id, candidateId, "workspace.read");
    }
    const results = await listBenchmarkResults({ benchmarkId: id, candidateId });
    return NextResponse.json(results);
  } catch (error) {
    return learningAccessErrorResponse(error);
  }
}

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser().catch(() => null);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const body = await req.json();
  if (!body.metrics) {
    return NextResponse.json({ error: "metrics is required" }, { status: 400 });
  }
  try {
    await requireBenchmarkAccess(user.id, id, "workspace.update");
    if (body.candidateId) {
      await requireLearningCandidateAccess(user.id, body.candidateId, "workspace.update");
    }
    const result = await recordBenchmarkResult({
      benchmarkId: id,
      candidateId: body.candidateId ?? null,
      agentId: body.agentId,
      version: body.version,
      metrics: body.metrics,
    });
    return NextResponse.json(result);
  } catch (error) {
    return learningAccessErrorResponse(error);
  }
}
