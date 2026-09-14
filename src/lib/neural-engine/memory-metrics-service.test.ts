import { afterAll, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import {
  consolidationCompression,
  estimateTokens,
  memoryStorageMetrics,
  retrievalFootprint,
  usefulRetrievalRate,
} from "./memory-metrics-service";
import { assessPromotionReadiness, compareShadowRetrieval } from "./shadow-retrieval-experiment";
import { recordMemoryRetrieval } from "./memory-usage-service";
import { resolveRetrievalOutcomes } from "./reconsolidation-service";

afterAll(async () => db.$disconnect());

const uniq = () => `metrics-${Date.now()}-${Math.random().toString(16).slice(2)}`;

describe("retrieval footprint", () => {
  it("counts redundant context, which is what consolidation must remove", () => {
    const footprint = retrievalFootprint([
      { content: "the migration keeps failing" },
      { content: "The Migration Keeps Failing" }, // same thing, different case
      { content: "something entirely different" },
    ]);

    expect(footprint.items).toBe(3);
    expect(footprint.duplicateItems).toBe(1);
    expect(footprint.duplicateTokens).toBeGreaterThan(0);
    expect(footprint.estimatedTokens).toBe(
      estimateTokens("the migration keeps failing") +
      estimateTokens("The Migration Keeps Failing") +
      estimateTokens("something entirely different"),
    );
  });
});

describe("useful retrieval rate", () => {
  it("reports null rather than zero before anything has been measured", async () => {
    const metrics = await usefulRetrievalRate(new Date(Date.now() + 60_000));
    expect(metrics.usefulRetrievalRate).toBeNull();
  });

  it("measures how often retrieved memory was present for success", async () => {
    const since = new Date();
    const owner = uniq();
    const memory = await db.memory.create({
      data: { type: "fact", scope: "global", owner, content: "c", source: "chat" },
    });
    const win = await db.experience.create({ data: { agentId: "codex", objective: uniq() } });
    const loss = await db.experience.create({ data: { agentId: "codex", objective: uniq() } });

    await recordMemoryRetrieval({ memoryIds: [memory.id], experienceId: win.id });
    await recordMemoryRetrieval({ memoryIds: [memory.id], experienceId: loss.id });
    await resolveRetrievalOutcomes({ experienceId: win.id, successScore: 0.9 });
    await resolveRetrievalOutcomes({ experienceId: loss.id, successScore: 0.1 });

    const metrics = await usefulRetrievalRate(since);
    expect(metrics.resolvedRetrievals).toBeGreaterThanOrEqual(2);
    expect(metrics.usefulRetrievalRate).not.toBeNull();
    expect(metrics.usefulRetrievalRate!).toBeGreaterThan(0);
    expect(metrics.usefulRetrievalRate!).toBeLessThan(1);
  });
});

describe("storage and compression", () => {
  it("reports storage split by how each memory came to exist", async () => {
    const metrics = await memoryStorageMetrics();
    expect(metrics.total).toBeGreaterThan(0);
    expect(Object.keys(metrics.byProvenance).length).toBeGreaterThan(0);
  });

  it("reports compression as episodes standing behind each abstraction", async () => {
    const metrics = await consolidationCompression();
    if (metrics.memoriesGenerated > 0) {
      expect(metrics.compressionRatio).toBeGreaterThan(0);
    } else {
      expect(metrics.compressionRatio).toBeNull();
    }
  });
});

describe("shadow retrieval experiment", () => {
  it("reports the token delta without changing production retrieval", async () => {
    const userId = uniq();
    await db.memory.createMany({
      data: [
        { type: "fact", scope: "global", owner: userId, content: "codex failed the prisma migration on tuesday", source: "chat" },
        { type: "fact", scope: "global", owner: userId, content: "codex failed the prisma migration on wednesday", source: "chat" },
      ],
    });
    await db.memory.create({
      data: {
        type: "agent_capability", scope: "global", owner: userId,
        content: "codex repeatedly fails the prisma migration step",
        source: "consolidation", provenanceClass: "GENERALIZED", shadowOnly: true,
        derivedFromExperienceIds: ["e1", "e2", "e3"],
      },
    });

    const comparison = await compareShadowRetrieval({ userId });

    expect(comparison.shadowMemoriesConsidered).toBe(1);
    expect(comparison.episodesRepresented).toBe(3);
    expect(["smaller", "larger", "unchanged"]).toContain(comparison.verdict);

    // Production retrieval is unchanged by running the experiment.
    const { memories } = await import("@/lib/knowledge/retrieval").then((m) => m.retrieveContext({ userId }));
    expect(memories.every((m) => !m.content.includes("repeatedly fails"))).toBe(true);
  });
});

describe("promotion readiness", () => {
  const solid = {
    provenanceClass: "GENERALIZED",
    derivedFromExperienceIds: ["e1", "e2", "e3"],
    confirmationCount: 3,
    disconfirmationCount: 0,
    contradictionCount: 0,
    confidence: 0.7,
  };

  it("promotes only a generalization that has earned it", () => {
    expect(assessPromotionReadiness(solid).ready).toBe(true);
  });

  it("refuses one with too little independent evidence", () => {
    const thin = assessPromotionReadiness({ ...solid, derivedFromExperienceIds: ["e1"] });
    expect(thin.ready).toBe(false);
    expect(thin.reasons.join(" ")).toMatch(/independent source episodes/);
  });

  it("refuses one that has never been confirmed since it was generated", () => {
    const unconfirmed = assessPromotionReadiness({ ...solid, confirmationCount: 0 });
    expect(unconfirmed.ready).toBe(false);
    expect(unconfirmed.reasons.join(" ")).toMatch(/independent confirmations/);
  });

  it("refuses one with unresolved contradictions", () => {
    expect(assessPromotionReadiness({ ...solid, contradictionCount: 1 }).ready).toBe(false);
  });

  it("refuses one that has not been more useful than not", () => {
    expect(assessPromotionReadiness({ ...solid, confirmationCount: 2, disconfirmationCount: 3 }).ready).toBe(false);
  });

  it("refuses one below the confidence floor", () => {
    expect(assessPromotionReadiness({ ...solid, confidence: 0.5 }).ready).toBe(false);
  });
});
