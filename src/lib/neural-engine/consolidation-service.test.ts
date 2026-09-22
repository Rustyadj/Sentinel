import { afterAll, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import {
  clusterEpisodes,
  consolidationPriority,
  objectiveTokens,
  tokenSimilarity,
  generalizationConfidence,
  MIN_EPISODES_FOR_GENERALIZATION,
  predictionError,
  runConsolidationCycle,
} from "./consolidation-service";
import { excludeFromRetrieval } from "@/lib/learning/memory-governance";

afterAll(async () => db.$disconnect());

const agent = () => `agent-${Date.now()}-${Math.random().toString(16).slice(2)}`;

async function makeEvaluatedExperience(agentId: string, objective: string, score: number) {
  return db.experience.create({
    data: {
      agentId,
      objective,
      completedAt: new Date(),
      evaluatorScore: score,
      outcomeStatus: score >= 0.5 ? "success" : "failure",
    },
  });
}

describe("surprise", () => {
  it("treats unexpected success and unexpected failure as equally informative", () => {
    expect(predictionError({ priorSuccessRate: 0.9, observedScore: 0.1 })).toBeCloseTo(0.8);
    expect(predictionError({ priorSuccessRate: 0.1, observedScore: 0.9 })).toBeCloseTo(0.8);
  });

  it("reports no surprise when there is no prior to violate", () => {
    expect(predictionError({ priorSuccessRate: null, observedScore: 0 })).toBe(0);
  });

  it("prioritises surprising outcomes over routine ones", () => {
    const routine = consolidationPriority({
      experienceId: "a", agentId: "x", domain: "d", objective: "o",
      succeeded: true, observedScore: 0.9, predictionError: 0.05,
    });
    const surprising = consolidationPriority({
      experienceId: "b", agentId: "x", domain: "d", objective: "o",
      succeeded: false, observedScore: 0.1, predictionError: 0.85,
    });
    expect(surprising).toBeGreaterThan(routine);
  });
});

describe("clustering", () => {
  const base = {
    agentId: "codex",
    domain: "migration-prisma-failure",
    objective: "prisma migration step keeps failing",
    priority: 0.5,
  };

  it("requires enough independent episodes before generalizing", () => {
    const two = clusterEpisodes([
      { ...base, experienceId: "e1", succeeded: false, observedScore: 0.1, predictionError: 0.5 },
      { ...base, experienceId: "e2", succeeded: false, observedScore: 0.2, predictionError: 0.5 },
    ]);
    expect(two).toHaveLength(0);

    const three = clusterEpisodes([
      { ...base, experienceId: "e1", succeeded: false, observedScore: 0.1, predictionError: 0.5 },
      { ...base, experienceId: "e2", succeeded: false, observedScore: 0.2, predictionError: 0.5 },
      { ...base, experienceId: "e3", succeeded: false, observedScore: 0.1, predictionError: 0.5 },
    ]);
    expect(three).toHaveLength(1);
    expect(three[0].experienceIds).toHaveLength(MIN_EPISODES_FOR_GENERALIZATION);
  });

  it("never lets one episode counted repeatedly reach the threshold", () => {
    const repeated = clusterEpisodes([
      { ...base, experienceId: "same", succeeded: false, observedScore: 0.1, predictionError: 0.5 },
      { ...base, experienceId: "same", succeeded: false, observedScore: 0.1, predictionError: 0.5 },
      { ...base, experienceId: "same", succeeded: false, observedScore: 0.1, predictionError: 0.5 },
      { ...base, experienceId: "same", succeeded: false, observedScore: 0.1, predictionError: 0.5 },
    ]);
    expect(repeated).toHaveLength(0);
  });

  it("never merges successes and failures into one claim", () => {
    // Three of each on identical wording: if direction were ignored these
    // would collapse into a single six-episode cluster asserting both things.
    const clusters = clusterEpisodes([
      { ...base, experienceId: "s1", succeeded: true, observedScore: 0.9, predictionError: 0.1 },
      { ...base, experienceId: "s2", succeeded: true, observedScore: 0.8, predictionError: 0.1 },
      { ...base, experienceId: "s3", succeeded: true, observedScore: 0.85, predictionError: 0.1 },
      { ...base, experienceId: "f1", succeeded: false, observedScore: 0.1, predictionError: 0.1 },
      { ...base, experienceId: "f2", succeeded: false, observedScore: 0.2, predictionError: 0.1 },
      { ...base, experienceId: "f3", succeeded: false, observedScore: 0.15, predictionError: 0.1 },
    ]);

    expect(clusters).toHaveLength(2);
    expect(clusters.every((c) => c.experienceIds.length === 3)).toBe(true);
    expect(new Set(clusters.map((c) => c.succeeded))).toEqual(new Set([true, false]));
  });

  it("recognises episodes describing the same problem despite differing wording", () => {
    const a = objectiveTokens("Fix the failing prisma migration");
    const b = objectiveTokens("prisma migration failing again");
    expect(tokenSimilarity(a, b)).toBeGreaterThanOrEqual(0.34);
  });

  it("does not treat unrelated work as the same problem", () => {
    const a = objectiveTokens("rewrite the billing invoice exporter");
    const b = objectiveTokens("prisma migration failing again");
    expect(tokenSimilarity(a, b)).toBeLessThan(0.34);
  });

  it("raises confidence with evidence but never to certainty", () => {
    expect(generalizationConfidence(3)).toBeLessThan(generalizationConfidence(6));
    expect(generalizationConfidence(100)).toBeLessThanOrEqual(0.85);
  });
});

describe("shadow consolidation cycle", () => {
  it("turns repeated episodes into one generalization that keeps its provenance", async () => {
    const agentId = agent();
    const objective = "codex keeps breaking the prisma migration step";
    const episodes = await Promise.all([
      makeEvaluatedExperience(agentId, objective, 0.1),
      makeEvaluatedExperience(agentId, "prisma migration step breaking again", 0.2),
      makeEvaluatedExperience(agentId, "breaking prisma migration once more", 0.15),
    ]);

    const result = await runConsolidationCycle({ mode: "shadow", agentId });
    expect(result.memoriesGenerated).toBeGreaterThanOrEqual(1);

    const derived = await db.memory.findFirstOrThrow({
      where: { owner: agentId, provenanceClass: "GENERALIZED" },
    });

    // Provenance survives abstraction — every source episode is still named.
    for (const episode of episodes) {
      expect(derived.derivedFromExperienceIds).toContain(episode.id);
    }
    expect(derived.confidence).toBeLessThanOrEqual(0.85);
    expect(derived.shadowOnly).toBe(true);

    // And the source episodes still exist in their own right.
    const surviving = await db.experience.findMany({ where: { id: { in: episodes.map((e) => e.id) } } });
    expect(surviving).toHaveLength(3);
    expect(surviving.every((e) => e.consolidationState === "consolidated")).toBe(true);
  });

  it("keeps generated memories out of production retrieval", async () => {
    const agentId = agent();
    const objective = "gemini fails the eslint gate consistently";
    await Promise.all([
      makeEvaluatedExperience(agentId, objective, 0.1),
      makeEvaluatedExperience(agentId, "eslint gate fails for gemini", 0.2),
      makeEvaluatedExperience(agentId, "fails eslint gate gemini run", 0.1),
    ]);

    await runConsolidationCycle({ mode: "shadow", agentId });

    const retrievable = await db.memory.findMany({ where: { owner: agentId, ...excludeFromRetrieval() } });
    expect(retrievable).toHaveLength(0);
  });

  it("strengthens an existing generalization instead of duplicating it", async () => {
    const agentId = agent();
    await Promise.all([
      makeEvaluatedExperience(agentId, "nathan2 times out on long research tasks", 0.1),
      makeEvaluatedExperience(agentId, "research tasks nathan2 timing out", 0.2),
      makeEvaluatedExperience(agentId, "long research tasks timing out nathan2", 0.1),
    ]);
    await runConsolidationCycle({ mode: "shadow", agentId });
    const first = await db.memory.findFirstOrThrow({ where: { owner: agentId, provenanceClass: "GENERALIZED" } });

    await Promise.all([
      makeEvaluatedExperience(agentId, "nathan2 timing out research tasks yet again", 0.1),
      makeEvaluatedExperience(agentId, "research nathan2 tasks timing out", 0.2),
      makeEvaluatedExperience(agentId, "timing out on research tasks nathan2", 0.1),
    ]);
    await runConsolidationCycle({ mode: "shadow", agentId });

    const all = await db.memory.findMany({ where: { owner: agentId, provenanceClass: "GENERALIZED" } });
    expect(all).toHaveLength(1);
    const updated = all[0];
    expect(updated.id).toBe(first.id);
    expect(updated.derivedFromExperienceIds.length).toBeGreaterThan(first.derivedFromExperienceIds.length);
    expect(updated.confidence).toBeGreaterThan(first.confidence);
  });

  it("records a durable, restart-safe run with a compression ratio", async () => {
    const agentId = agent();
    const before = await db.consolidationRun.count();
    const result = await runConsolidationCycle({ mode: "shadow", limit: 50, agentId });
    expect(await db.consolidationRun.count()).toBe(before + 1);

    const run = await db.consolidationRun.findUniqueOrThrow({ where: { id: result.runId } });
    expect(run.mode).toBe("shadow");
    expect(run.completedAt).not.toBeNull();
  });

  it("does not re-consolidate an experience a later cycle already claimed", async () => {
    const agentId = agent();
    await makeEvaluatedExperience(agentId, "one-off unremarkable task", 0.9);

    await runConsolidationCycle({ mode: "shadow", agentId });
    const second = await runConsolidationCycle({ mode: "shadow", agentId });

    const stillPending = await db.experience.count({ where: { agentId, consolidationState: "pending" } });
    expect(stillPending).toBe(0);
    expect(second.experiencesScanned).toBe(0);
  });
});
