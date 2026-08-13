import { db } from "@/lib/db";
import { removeBenchmarkFromGraph, syncBenchmarkToGraph } from "./graph";

export async function createBenchmark(input: {
  name: string;
  metric: string;
  value: number;
  baselineValue?: number;
  experimentId?: string;
}) {
  const benchmark = await db.benchmark.create({
    data: {
      name: input.name,
      metric: input.metric,
      value: input.value,
      baselineValue: input.baselineValue ?? null,
      experimentId: input.experimentId ?? null,
    },
  });
  await syncBenchmarkToGraph(benchmark);
  return benchmark;
}

export async function listBenchmarks(params?: { experimentId?: string; metric?: string; limit?: number }) {
  const benchmarks = await db.benchmark.findMany({
    where: {
      ...(params?.experimentId ? { experimentId: params.experimentId } : {}),
      ...(params?.metric ? { metric: params.metric } : {}),
    },
    include: { experiment: { select: { id: true, type: true, version: true, status: true } } },
    orderBy: { createdAt: "desc" },
    take: params?.limit ?? 200,
  });
  return benchmarks.map((benchmark) => ({
    ...benchmark,
    comparison:
      benchmark.baselineValue === null
        ? null
        : {
            delta: benchmark.value - benchmark.baselineValue,
            percentChange:
              benchmark.baselineValue === 0
                ? null
                : ((benchmark.value - benchmark.baselineValue) / Math.abs(benchmark.baselineValue)) * 100,
          },
  }));
}

export async function getBenchmark(id: string) {
  return db.benchmark.findUnique({ where: { id }, include: { experiment: true } });
}

export async function deleteBenchmark(id: string) {
  const benchmark = await db.benchmark.delete({ where: { id } });
  await removeBenchmarkFromGraph(id);
  return benchmark;
}
