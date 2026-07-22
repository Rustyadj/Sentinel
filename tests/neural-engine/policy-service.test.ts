import { describe, expect, it } from "vitest";
import {
  canAutoApprove,
  classifyRiskLevel,
  isAutoApproveThresholdMet,
} from "@/lib/neural-engine/policy-service";
import {
  AUTO_APPROVE_MIN_CONFIDENCE,
  AUTO_APPROVE_MIN_EVIDENCE,
} from "@/lib/neural-engine/types";

describe("policy-service — hard-rule guardrails", () => {
  it("never marks prompt_change as auto-approve eligible, regardless of evidence/confidence", () => {
    const classification = classifyRiskLevel("prompt_change");
    expect(classification.riskLevel).toBe("high");
    expect(classification.autoApproveEligible).toBe(false);

    expect(canAutoApprove("prompt_change", 1000, 0.99)).toBe(false);
  });

  it("never marks tool_policy_change as auto-approve eligible, regardless of evidence/confidence", () => {
    expect(canAutoApprove("tool_policy_change", 1000, 0.99)).toBe(false);
  });

  it("respects a caller-supplied high risk level even for allowlisted types", () => {
    const classification = classifyRiskLevel("confidence_update", "high");
    expect(classification.autoApproveEligible).toBe(false);
  });

  it("allows low-risk types to be auto-approve eligible when they meet thresholds", () => {
    expect(
      canAutoApprove(
        "confidence_update",
        AUTO_APPROVE_MIN_EVIDENCE,
        AUTO_APPROVE_MIN_CONFIDENCE,
      ),
    ).toBe(true);
    expect(
      canAutoApprove("relationship", AUTO_APPROVE_MIN_EVIDENCE, AUTO_APPROVE_MIN_CONFIDENCE),
    ).toBe(true);
  });

  it("rejects low-risk types when evidence is below threshold", () => {
    expect(
      canAutoApprove(
        "confidence_update",
        AUTO_APPROVE_MIN_EVIDENCE - 1,
        AUTO_APPROVE_MIN_CONFIDENCE,
      ),
    ).toBe(false);
  });

  it("rejects low-risk types when confidence is below threshold", () => {
    expect(
      canAutoApprove(
        "confidence_update",
        AUTO_APPROVE_MIN_EVIDENCE,
        AUTO_APPROVE_MIN_CONFIDENCE - 0.2,
      ),
    ).toBe(false);
  });

  it("defaults non-allowlisted types (e.g. memory, decision, skill) to requiring review", () => {
    for (const type of ["memory", "decision", "skill", "procedure"] as const) {
      const classification = classifyRiskLevel(type);
      expect(classification.autoApproveEligible).toBe(false);
    }
  });

  it("isAutoApproveThresholdMet is a strict >= comparison at the boundary", () => {
    expect(
      isAutoApproveThresholdMet(AUTO_APPROVE_MIN_EVIDENCE, AUTO_APPROVE_MIN_CONFIDENCE),
    ).toBe(true);
    expect(
      isAutoApproveThresholdMet(AUTO_APPROVE_MIN_EVIDENCE - 1, AUTO_APPROVE_MIN_CONFIDENCE),
    ).toBe(false);
  });
});
