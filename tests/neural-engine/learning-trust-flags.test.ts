import { afterAll, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import {
  TRUST_EVENT_DELTAS,
  evaluateTrustAutomationEligibility,
  getAgentTrustProfile,
  recordTrustEvent,
} from "@/lib/learning/trust";
import {
  createFeatureFlag,
  evaluateFlag,
  getFeatureFlagBucket,
  updateFeatureFlag,
} from "@/lib/learning/feature-flags";
import { uid } from "./db-setup";

afterAll(async () => {
  await db.$disconnect();
});

describe("Learning Core — capability-specific trust history (integration)", () => {
  it("records the policy delta and updates only the matching competency domain", async () => {
    const agentId = uid("trust-agent");
    await db.agentCompetency.create({
      data: {
        agentId,
        domain: "formatting",
        score: 0.8,
        evidenceCount: 4,
        successRate: 0.75,
      },
    });

    const result = await recordTrustEvent({
      agentId,
      domain: "Workflow",
      eventType: "benchmark_improvement",
      reason: "Workflow benchmark improved over baseline.",
    });

    expect(TRUST_EVENT_DELTAS.benchmark_improvement).toBe(3);
    expect(result.event.delta).toBe(3);
    expect(result.competency.domain).toBe("workflow");
    expect(result.competency.score).toBeCloseTo(0.53, 3);
    const formatting = await db.agentCompetency.findUniqueOrThrow({
      where: { agentId_domain: { agentId, domain: "formatting" } },
    });
    expect(formatting.score).toBe(0.8);
    expect(formatting.evidenceCount).toBe(4);

    const profile = await getAgentTrustProfile(agentId);
    expect(profile.domains.map((domain) => domain.domain)).toEqual(["formatting", "workflow"]);
    expect(profile.recentEvents[0].id).toBe(result.event.id);
  });

  it("never lets trust make Tier 3 or protected candidate operations eligible", () => {
    expect(evaluateTrustAutomationEligibility({ competencyScore: 1, riskTier: 3 })).toEqual({
      eligible: false,
      reason: "Tier 3 operations always require explicit authorization.",
    });
    expect(evaluateTrustAutomationEligibility({
      competencyScore: 1,
      riskTier: 1,
      candidateType: "prompt_change",
    }).eligible).toBe(false);
  });
});

describe("Learning Core — deterministic feature flags (integration)", () => {
  it("returns the same assignment for the same key and context every time", async () => {
    const key = uid("deterministic-flag");
    const userId = uid("flag-user");
    await createFeatureFlag({
      key,
      name: "Deterministic rollout",
      enabled: true,
      rolloutPercentage: 50,
    });

    const bucket = getFeatureFlagBucket(key, userId);
    expect(bucket).toBeGreaterThanOrEqual(0);
    expect(bucket).toBeLessThan(100);
    expect(getFeatureFlagBucket(key, userId)).toBe(bucket);
    const evaluations = await Promise.all(
      Array.from({ length: 5 }, () => evaluateFlag(key, { userId })),
    );
    expect(new Set(evaluations).size).toBe(1);
    expect(evaluations[0]).toBe(bucket < 50);
  });

  it("never enables a disabled flag, even at 100 percent rollout", async () => {
    const key = uid("disabled-flag");
    const flag = await createFeatureFlag({
      key,
      name: "Emergency kill switch",
      enabled: true,
      rolloutPercentage: 100,
    });
    const context = { userId: uid("flag-user") };

    expect(await evaluateFlag(key, context)).toBe(true);
    await updateFeatureFlag(flag.id, { enabled: false });
    expect(await evaluateFlag(key, context)).toBe(false);
  });
});
