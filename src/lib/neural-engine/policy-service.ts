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

export type RiskPolicySurface = LearningCandidateType | "feature_flag";

export interface SkillPermissionRiskClassification extends RiskClassification {
  permissions: string[];
  sensitivePermissions: string[];
}

const HIGH_RISK_PERMISSION_PATTERN =
  /(^|[:._-])(admin|credential|delete|deploy|exec|filesystem|network|permission|secret|shell|write)([:._-]|$)/i;
const WILDCARD_PERMISSION_PATTERN = /(^\*$)|(^all$)|(^.*:\*$)/i;

/**
 * Classify a proposed learning candidate's risk level and whether it is even
 * *eligible* for auto-approval (eligibility still requires evidence/confidence
 * thresholds to be met at review time — see isAutoApproveThresholdMet).
 */
export function classifyRiskLevel(
  type: RiskPolicySurface,
  requestedRiskLevel?: RiskLevel,
): RiskClassification {
  if (type !== "feature_flag" && ALWAYS_HIGH_RISK_TYPES.has(type)) {
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

  if (type !== "feature_flag" && AUTO_APPROVABLE_TYPES.has(type)) {
    return {
      riskLevel: requestedRiskLevel ?? "low",
      autoApproveEligible: true,
      reason: `"${type}" is on the low-risk auto-learning allowlist.`,
    };
  }

  if (type === "feature_flag" && requestedRiskLevel !== "medium") {
    return {
      riskLevel: "low",
      autoApproveEligible: true,
      reason: "Low-risk feature-flag rollout is eligible for controlled automation.",
    };
  }

  return {
    riskLevel: requestedRiskLevel ?? "medium",
    autoApproveEligible: false,
    reason: `"${type}" is not on the auto-learning allowlist — requires review.`,
  };
}

/**
 * Generated executable skills are always Tier 2 or Tier 3. Permissions are
 * normalized and checked here so proposal and activation cannot drift onto
 * separate risk paths. Wildcards are rejected instead of expanded.
 */
export function classifySkillPermissionRisk(
  declaredPermissions: unknown,
  explicitlyRequestedPermissions: unknown = declaredPermissions,
): SkillPermissionRiskClassification {
  const requested = normalizePermissions(explicitlyRequestedPermissions, "requestedPermissions");
  const permissions = normalizePermissions(declaredPermissions, "permissions");
  const requestedSet = new Set(requested);
  const undeclaredGrant = permissions.find((permission) => !requestedSet.has(permission));
  if (undeclaredGrant) {
    throw new Error(
      `Permission "${undeclaredGrant}" was not explicitly requested and analyzed.`,
    );
  }

  const sensitivePermissions = permissions.filter((permission) =>
    HIGH_RISK_PERMISSION_PATTERN.test(permission),
  );
  const classification = classifyRiskLevel(
    "skill",
    sensitivePermissions.length > 0 ? "high" : "medium",
  );
  return { ...classification, permissions, sensitivePermissions };
}

/**
 * Final state-transition gate. Trust is intentionally not an input: it can
 * affect automation eligibility elsewhere, but can never satisfy Tier 3 or
 * protected-surface authorization here.
 */
export function assertRiskTransitionAuthorized(input: {
  classification: RiskClassification;
  transition: string;
  humanAuthorized: boolean;
  riskReducing?: boolean;
}): void {
  if (input.riskReducing || input.classification.autoApproveEligible) return;
  if (input.humanAuthorized) return;
  throw new Error(
    `${input.transition} requires explicit human authorization at ${input.classification.riskLevel} risk.`,
  );
}

function normalizePermissions(value: unknown, field: string): string[] {
  if (!Array.isArray(value) || value.some((permission) => typeof permission !== "string")) {
    throw new Error(`${field} must be an explicit array of permission strings.`);
  }
  const normalized = [...new Set(value.map((permission) => permission.trim()).filter(Boolean))];
  const wildcard = normalized.find((permission) => WILDCARD_PERMISSION_PATTERN.test(permission));
  if (wildcard) {
    throw new Error(`Wildcard permission "${wildcard}" is not allowed.`);
  }
  return normalized;
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
