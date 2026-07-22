import { describe, expect, it } from "vitest";
import {
  checkPromotionEligibility,
  MIN_PROMOTION_DISTINCT_TASKS,
  MIN_PROMOTION_EVALUATOR_CONFIDENCE,
  MIN_PROMOTION_EVIDENCE_COUNT,
  MIN_PROMOTION_SUCCESS_RATE,
  type PromotionEvidence,
} from "@/lib/neural-engine/skill-service";

const strongEvidence: PromotionEvidence = {
  evidenceCount: MIN_PROMOTION_EVIDENCE_COUNT,
  successRate: MIN_PROMOTION_SUCCESS_RATE,
  distinctTaskCount: MIN_PROMOTION_DISTINCT_TASKS,
  evaluatorConfidence: MIN_PROMOTION_EVALUATOR_CONFIDENCE,
  hasUnresolvedSafetyFailure: false,
};

describe("skill-service — promotion threshold (no auto-promoting one-off successes)", () => {
  it("is eligible when every threshold is exactly met", () => {
    expect(checkPromotionEligibility(strongEvidence).eligible).toBe(true);
  });

  it("rejects a single successful run (evidenceCount=1, distinctTaskCount=1)", () => {
    const oneOff: PromotionEvidence = {
      ...strongEvidence,
      evidenceCount: 1,
      distinctTaskCount: 1,
    };
    const result = checkPromotionEligibility(oneOff);
    expect(result.eligible).toBe(false);
    expect(result.reasons.some((r) => r.includes("evidenceCount"))).toBe(true);
    expect(result.reasons.some((r) => r.includes("distinctTaskCount"))).toBe(true);
  });

  it("rejects below-threshold success rate even with plenty of evidence", () => {
    const flaky: PromotionEvidence = { ...strongEvidence, successRate: 0.4, evidenceCount: 20 };
    expect(checkPromotionEligibility(flaky).eligible).toBe(false);
  });

  it("rejects when there is an unresolved safety failure, regardless of everything else", () => {
    const unsafe: PromotionEvidence = {
      ...strongEvidence,
      evidenceCount: 100,
      successRate: 1,
      distinctTaskCount: 50,
      evaluatorConfidence: 1,
      hasUnresolvedSafetyFailure: true,
    };
    const result = checkPromotionEligibility(unsafe);
    expect(result.eligible).toBe(false);
    expect(result.reasons.some((r) => r.includes("safety"))).toBe(true);
  });

  it("rejects low evaluator confidence", () => {
    const unsure: PromotionEvidence = { ...strongEvidence, evaluatorConfidence: 0.2 };
    expect(checkPromotionEligibility(unsure).eligible).toBe(false);
  });
});
