// Sentinel memory benchmark — fixture seeding and execution.
//
// Two rules keep the numbers honest:
//
//   1. Retrieval runs through the same entry point a real agent uses
//      (buildMemoryContext). The benchmark never calls a planner or a SQL
//      query the production path does not call, because then it would be
//      measuring code nobody runs.
//   2. The retriever is an interface. Later phases (multi-lane retrieval,
//      reranking) register another implementation and are scored by exactly
//      the same cases and metrics, so the comparison is like-for-like.

import { db } from "@/lib/db";
import { buildMemoryContext } from "@/lib/neural-engine/memory-context";
import { readEmbeddingConfig, MODEL_DIMENSIONS } from "@/lib/neural-engine/embeddings";
import { reconsolidateScope } from "@/lib/neural-engine/reconsolidation-engine";
import { scoreCase, DEFAULT_K_VALUES } from "./metrics";
import { WORLD, CASES } from "./dataset";
import type { BenchCase, BenchMemory, CaseResult } from "./types";

const DAY_MS = 24 * 60 * 60 * 1000;

/** Everything the benchmark creates carries this prefix, so teardown can be
 *  exact rather than a truncate. The benchmark must never be capable of
 *  deleting a row it did not create. */
export const BENCH_PREFIX = "bench-";

export interface Retriever {
  name: string;
  /** Returns retrieved ids in rank order, the ids that survived the token
   *  budget, and the rendered token count. */
  run(testCase: BenchCase): Promise<{
    retrievedIds: string[];
    injectedIds: string[];
    contextTokens: number;
    embeddingMs: number;
    rerankMs: number;
  }>;
}

/**
 * The current production path, exactly as chat / orchestration / MCP call it.
 *
 * The baseline run of this benchmark recorded what happened when
 * RetrievalContext had no query field at all: retrieval returned the top-N
 * in-scope memories by (pinned, valueScore, importanceScore, createdAt) and
 * never saw the question, so 32 cases produced 4 distinct result sets. The
 * query is now passed through and ranked on; baseline.json is kept as the
 * before picture.
 */
export const productionRetriever: Retriever = {
  name: "production:buildMemoryContext",
  async run(testCase) {
    const result = await buildMemoryContext(
      {
        userId: testCase.ctx.userId,
        query: testCase.query,
        projectId: testCase.ctx.projectId,
        workspaceId: testCase.ctx.workspaceId,
        organizationId: testCase.ctx.organizationId,
        scopePolicy: testCase.ctx.scopePolicy,
        maxItems: testCase.ctx.maxItems,
      },
      { consumer: "task" },
    );
    return {
      retrievedIds: result.retrievedMemoryIds,
      injectedIds: result.context.injected.map((entry) => entry.memoryId),
      contextTokens: result.context.estimatedTokens,
      embeddingMs: 0,
      rerankMs: 0,
    };
  },
};

function memoryRow(memory: BenchMemory, now: number) {
  const createdAt = new Date(now - (memory.ageDays ?? 0) * DAY_MS);
  return {
    id: memory.id,
    type: memory.type,
    scope: memory.scope,
    owner: memory.owner,
    content: memory.content,
    tags: memory.tags ?? [],
    confidence: memory.confidence ?? 0.9,
    importanceScore: memory.importanceScore ?? 0.5,
    valueScore: memory.valueScore ?? null,
    source: memory.source,
    pinned: memory.pinned ?? false,
    archived: memory.archived ?? false,
    projectId: memory.projectId ?? null,
    state: memory.state ?? "active",
    provenanceClass: memory.provenanceClass ?? "OBSERVED",
    createdAt,
    updatedAt: createdAt,
    validFrom: createdAt,
    validTo: memory.validTo == null ? null : new Date(now - memory.validTo * DAY_MS),
    supersededById: memory.supersededById ?? null,
  };
}

/** Remove only rows this benchmark created, in dependency order. */
export async function teardown(): Promise<void> {
  const ids = WORLD.memories.map((memory) => memory.id);
  await db.memoryReconsolidation.deleteMany({ where: { memoryId: { in: ids } } });
  await db.memoryRetrieval.deleteMany({ where: { memoryId: { in: ids } } });
  await db.memory.deleteMany({ where: { id: { in: ids } } });
  await db.project.deleteMany({ where: { id: { in: WORLD.projects.map((p) => p.id) } } });
  await db.workspace.deleteMany({ where: { id: { in: WORLD.workspaces.map((w) => w.id) } } });
  await db.user.deleteMany({ where: { id: { in: WORLD.users.map((u) => u.id) } } });
}

export async function seed(): Promise<void> {
  await teardown();
  const now = Date.now();

  for (const user of WORLD.users) {
    await db.user.create({ data: { id: user.id, email: user.email, name: user.name } });
  }
  for (const workspace of WORLD.workspaces) {
    await db.workspace.create({
      data: { id: workspace.id, slug: workspace.slug, name: workspace.name, ownerId: workspace.ownerId },
    });
  }
  for (const project of WORLD.projects) {
    await db.project.create({
      data: { id: project.id, name: project.name, userId: project.userId, workspaceId: project.workspaceId },
    });
  }

  // supersededById references another memory id, so rows are written without
  // it first and the links are applied in a second pass.
  for (const memory of WORLD.memories) {
    const row = memoryRow(memory, now);
    await db.memory.create({ data: { ...row, supersededById: null } });
  }
  for (const memory of WORLD.memories) {
    if (!memory.supersededById) continue;
    await db.memory.update({ where: { id: memory.id }, data: { supersededById: memory.supersededById } });
  }

  await consolidate();
}

/**
 * Run the production reconsolidation pass over the seeded corpus.
 *
 * The fixtures above are raw observations: what a user actually said, in the
 * order they said it. Only `mem-sentinel-port-old` carries a supersession link,
 * because that fixture exists to test that a *recorded* supersession is
 * honoured. `mem-sentinel-model-old` does not, because that one exists to test
 * what happens when a correction arrives as an ordinary memory — which is how
 * corrections actually arrive.
 *
 * Phase 7 had no answer for the second case and surfaced the stale belief
 * alongside the correction. Phase 8's answer is not a retrieval filter; it is
 * that the link should have been made when the correction was stored. So the
 * benchmark seeds the raw corpus and then runs exactly the code production
 * runs, rather than seeding a corpus that has been pre-resolved by hand.
 *
 * `apply` is explicit here. Production defaults to shadow (see
 * defaultMode()); the benchmark is the evidence that decides whether that
 * default should change.
 */
export async function consolidate(): Promise<void> {
  // Ablation switch. The point of a benchmark is to attribute a change to the
  // thing that caused it, and two things landed in Phase 8: contradiction
  // handling and a tokenizer fix. Setting this seeds the corpus unconsolidated
  // so the two can be measured apart.
  if (process.env.SENTINEL_BENCH_NO_CONSOLIDATE === "1") return;
  for (const user of WORLD.users) {
    await reconsolidateScope({ owner: user.id }, { mode: "apply", origin: "benchmark" });
  }
}

export async function runCases(
  retriever: Retriever,
  cases: BenchCase[] = CASES,
  kValues: number[] = DEFAULT_K_VALUES,
): Promise<CaseResult[]> {
  const results: CaseResult[] = [];
  for (const testCase of cases) {
    const startedAt = performance.now();
    try {
      const outcome = await retriever.run(testCase);
      const retrievalMs = performance.now() - startedAt;
      results.push(
        scoreCase(
          testCase,
          outcome.retrievedIds,
          outcome.injectedIds,
          {
            retrievalMs,
            embeddingMs: outcome.embeddingMs,
            rerankMs: outcome.rerankMs,
            contextTokens: outcome.contextTokens,
          },
          kValues,
        ),
      );
    } catch (error) {
      const retrievalMs = performance.now() - startedAt;
      const scored = scoreCase(testCase, [], [], { retrievalMs, embeddingMs: 0, rerankMs: 0, contextTokens: 0 }, kValues);
      scored.error = error instanceof Error ? error.message : String(error);
      results.push(scored);
    }
  }
  return results;
}

export function embeddingMeta() {
  const config = readEmbeddingConfig();
  return {
    embeddingProvider: config.provider,
    embeddingModel: config.model,
    embeddingDimensions: MODEL_DIMENSIONS[config.model] ?? null,
  };
}
