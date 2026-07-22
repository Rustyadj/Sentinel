// Sentinel Neural Engine — Policy service
//
// Central guard for the "SELF-IMPROVEMENT SAFETY" hard rules. Every mutation
// that originates from a LearningCandidate must pass through
// classifyRiskLevel() before it is allowed to auto-apply. This is
// deliberately the *only* place that hard-codes the never-auto-approve list
// so the rule can't quietly drift out of sync between services.

import {
  ALWAYS_HIGH_RISK_TYPES,
  AUTO_APPROVABLE_TYPES,
  AUTO_APPROVE_MIN_CONFIDENCE,
  AUTO_APPROVE_MIN_EVIDENCE,
  type LearningCandidateType,
  type RiskLevel,
} from "./types";

export interface RiskClassification {
  riskLevel: RiskLevel;
  autoApproveEligible: boolean;
  reason: string;
}

/**
 * Classify a proposed learning candidate's risk level and whether it is even
 * *eligible* for auto-approval (eligibility still requires evidence/confidence
 * thresholds to be met at review time — see isAutoApproveThresholdMet).
 */
export function classifyRiskLevel(
  type: LearningCandidateType,
  requestedRiskLevel?: RiskLevel,
): RiskClassification {
  if (ALWAYS_HIGH_RISK_TYPES.has(type)) {
    return {
      riskLevel: "high",
      autoApproveEligible: false,
      reason: `"${type}" is a protected surface — always requires human review.`,
    };
  }

  if (requestedRiskLevel === "high") {
    return {
      riskLevel: "high",
      autoApproveEligible: false,
      reason: "Caller flagged this candidate as high risk.",
    };
  }

  if (AUTO_APPROVABLE_TYPES.has(type)) {
    return {
      riskLevel: requestedRiskLevel ?? "low",
      autoApproveEligible: true,
      reason: `"${type}" is on the low-risk auto-learning allowlist.`,
    };
  }

  return {
    riskLevel: requestedRiskLevel ?? "medium",
    autoApproveEligible: false,
    reason: `"${type}" is not on the auto-learning allowlist — requires review.`,
  };
}

/** Evidence/confidence gate — auto-approval requires BOTH eligibility and threshold. */
export function isAutoApproveThresholdMet(
  evidenceCount: number,
  confidence: number,
): boolean {
  return (
    evidenceCount >= AUTO_APPROVE_MIN_EVIDENCE &&
    confidence >= AUTO_APPROVE_MIN_CONFIDENCE
  );
}

/**
 * Final gate combining risk classification + thresholds. Used by
 * learning-service before it ever writes to canonical tables without a human
 * in the loop.
 */
export function canAutoApprove(
  type: LearningCandidateType,
  evidenceCount: number,
  confidence: number,
  requestedRiskLevel?: RiskLevel,
): boolean {
  const classification = classifyRiskLevel(type, requestedRiskLevel);
  return (
    classification.autoApproveEligible &&
    isAutoApproveThresholdMet(evidenceCount, confidence)
  );
}
