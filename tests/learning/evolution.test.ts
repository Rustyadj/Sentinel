import { afterAll, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import {
  proposeEvolutionCandidate,
  recordFitness,
  promoteChallenger,
  getCandidateLineage,
  computeNoveltyScore,
  computeFitnessScore,
  evaluateGuardrails,
} from "@/lib/learning/evolution";
import { uid } from "../neural-engine/db-setup";

afterAll(async () => {
  await db.$disconnect();
});

describe("Evolution Archive — novelty and fitness (pure)", () => {
  it("novelty is 1 for the first candidate in a group (no siblings)", () => {
    expect(computeNoveltyScore({ a: 1 }, [])).toBe(1);
  });

  it("novelty is low for a near-identical sibling and high for a structurally distinct one", () => {
    const candidate = { retrievalWeights: { semantic: 0.7, recency: 0.3 } };
    const nearDuplicateSibling = { retrievalWeights: { semantic: 0.72, recency: 0.28 } };
    const distinctSibling = { rerankStrategy: "cross-encoder", memorySelectionPolicy: "diversity-first" };

    const lowNovelty = computeNoveltyScore(candidate, [nearDuplicateSibling]);
    const highNovelty = computeNoveltyScore(candidate, [distinctSibling]);
    expect(highNovelty).toBeGreaterThan(lowNovelty);
  });

  it("fitness score inverts lower-is-better dimensions (hallucinationRate)", () => {
    const good = computeFitnessScore({ taskSuccess: 0.9, hallucinationRate: 0.05 });
    const bad = computeFitnessScore({ taskSuccess: 0.9, hallucinationRate: 0.6 });
    expect(good).toBeGreaterThan(bad);
  });

  it("a fitness improvement does not override a hard guardrail regression (spec's worked example)", () => {
    const champion = { taskSuccess: 0.7, hallucinationRate: 0.1 };
    const challenger = { taskSuccess: 0.74, hallucinationRate: 0.13 }; // +4% task success, +3% hallucination
    const violations = evaluateGuardrails(champion, challenger);
    expect(violations.length).toBeGreaterThan(0);
  });

  it("no guardrail violation when nothing protected regresses", () => {
    const champion = { taskSuccess: 0.7, hallucinationRate: 0.1, safety: 0.9 };
    const challenger = { taskSuccess: 0.8, hallucinationRate: 0.08, safety: 0.9 };
    expect(evaluateGuardrails(champion, challenger)).toEqual([]);
  });
});

describe("Evolution Archive — lineage and champion/challenger (integration)", () => {
  it("lineage is preserved across generations", async () => {
    const root = await proposeEvolutionCandidate({
      type: "confidence_update",
      proposedPayload: { agentId: uid("agent"), knowledgeObjectId: uid("ko"), outcome: "success" },
      riskLevel: "low",
      evidenceCount: 1,
      confidence: 0.4,
      championGroup: `retrieval_ranking_${uid("grp")}`,
    });

    const child = await proposeEvolutionCandidate({
      type: "confidence_update",
      proposedPayload: { agentId: uid("agent"), knowledgeObjectId: uid("ko"), outcome: "success", magnitude: 0.3 },
      riskLevel: "low",
      evidenceCount: 1,
      confidence: 0.4,
      parentCandidateId: root.candidate.id,
    });

    expect(child.candidate.rootCandidateId).toBe(root.candidate.id);
    expect(child.candidate.generation).toBe(1);
    expect(child.candidate.lineageDepth).toBe(1);
    expect(child.candidate.championGroup).toBe(root.candidate.championGroup);

    const lineage = await getCandidateLineage(child.candidate.id);
    const ids = lineage.map((c) => c.id);
    expect(ids).toContain(root.candidate.id);
    expect(ids).toContain(child.candidate.id);
    expect(lineage[0].id).toBe(root.candidate.id); // ordered by generation ascending
  });

  it("promoting a challenger demotes (never deletes) the previous champion; rejected candidates remain in the archive", async () => {
    const group = `clarification_policy_${uid("grp")}`;

    const championSeed = await db.learningCandidate.create({
      data: {
        type: "procedure",
        proposedPayload: { strategy: "lower_ambiguity_threshold" },
        status: "auto_approved",
        riskLevel: "low",
        championGroup: group,
        survivalStatus: "challenger",
      },
    });
    await recordFitness(championSeed.id, { taskSuccess: 0.6, safety: 0.9 });
    const firstPromotion = await promoteChallenger(championSeed.id, { actorId: "test-actor" });
    expect(firstPromotion.promoted).toBe(true);

    const rejected = await db.learningCandidate.create({
      data: {
        type: "procedure",
        proposedPayload: { strategy: "intent_verification" },
        status: "rejected",
        riskLevel: "low",
        championGroup: group,
        survivalStatus: "rejected",
      },
    });

    const strongerChallenger = await db.learningCandidate.create({
      data: {
        type: "procedure",
        proposedPayload: { strategy: "contradiction_detection" },
        status: "auto_approved",
        riskLevel: "low",
        championGroup: group,
        survivalStatus: "challenger",
      },
    });
    await recordFitness(strongerChallenger.id, { taskSuccess: 0.85, safety: 0.9 });

    const secondPromotion = await promoteChallenger(strongerChallenger.id, { actorId: "test-actor" });
    expect(secondPromotion.promoted).toBe(true);
    expect(secondPromotion.championId).toBe(championSeed.id);

    const previousChampion = await db.learningCandidate.findUniqueOrThrow({ where: { id: championSeed.id } });
    expect(previousChampion.survivalStatus).toBe("superseded"); // demoted, row still exists

    const stillRejected = await db.learningCandidate.findUniqueOrThrow({ where: { id: rejected.id } });
    expect(stillRejected.survivalStatus).toBe("rejected"); // rejected candidates are never deleted

    const currentChampion = await db.learningCandidate.findUniqueOrThrow({ where: { id: strongerChallenger.id } });
    expect(currentChampion.survivalStatus).toBe("champion");
  });

  it("a lower-fitness challenger cannot dethrone a stronger champion — champion never disappears without evidence", async () => {
    const group = `retrieval_ranking_${uid("grp")}`;
    const champion = await db.learningCandidate.create({
      data: {
        type: "procedure",
        proposedPayload: { strategy: "x" },
        status: "auto_approved",
        riskLevel: "low",
        championGroup: group,
        survivalStatus: "champion",
      },
    });
    await recordFitness(champion.id, { taskSuccess: 0.9 });

    const weakChallenger = await db.learningCandidate.create({
      data: {
        type: "procedure",
        proposedPayload: { strategy: "y" },
        status: "auto_approved",
        riskLevel: "low",
        championGroup: group,
        survivalStatus: "challenger",
      },
    });
    await recordFitness(weakChallenger.id, { taskSuccess: 0.5 });

    const decision = await promoteChallenger(weakChallenger.id, { actorId: "test-actor" });
    expect(decision.promoted).toBe(false);

    const stillChampion = await db.learningCandidate.findUniqueOrThrow({ where: { id: champion.id } });
    expect(stillChampion.survivalStatus).toBe("champion");
  });

  it("descendant fitness evaluation increments evaluationCount and recomputes fitnessScore", async () => {
    const candidate = await db.learningCandidate.create({
      data: { type: "procedure", proposedPayload: { strategy: "z" }, riskLevel: "low" },
    });
    const first = await recordFitness(candidate.id, { taskSuccess: 0.5 });
    expect(first.evaluationCount).toBe(1);
    const second = await recordFitness(candidate.id, { accuracy: 0.9 });
    expect(second.evaluationCount).toBe(2);
    expect((second.fitnessVector as Record<string, number>).taskSuccess).toBe(0.5); // merged, not overwritten
    expect((second.fitnessVector as Record<string, number>).accuracy).toBe(0.9);
  });
});
