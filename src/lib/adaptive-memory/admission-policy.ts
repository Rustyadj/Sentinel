import type { MemorySourceType, ProposeMemoryCandidateInput } from "./types";
import { scanUntrustedContent } from "./security";

const EXTERNAL_SOURCES = new Set<MemorySourceType>([
  "external_document", "email", "web", "import", "tool_output",
]);
const HIGH_RISK_TERMS = /\b(deploy|production|security|permission|credential|financial|payment|legal|contract|delete|infrastructure|database|firewall)\b/i;

export interface AdmissionDecision {
  status: "pending" | "auto_approved" | "quarantined";
  reasons: string[];
  requiresHumanReview: boolean;
}

export function evaluateAdmission(input: ProposeMemoryCandidateInput): AdmissionDecision {
  const reasons: string[] = [];
  const findings = scanUntrustedContent(input.content);
  reasons.push(...findings.map((finding) => finding.code));

  if (input.sourceType === "agent_inference" && input.provenance.evidenceIds.length === 0) {
    reasons.push("agent_inference_without_evidence");
  }
  if (input.sourceType === "workflow" && input.proposedBy === input.runId) {
    reasons.push("self_promotion_attempt");
  }
  if (input.risk >= 0.65 || HIGH_RISK_TERMS.test(input.content) || input.candidateType === "policy") {
    reasons.push("high_risk_domain");
  }

  const poisoned = reasons.some((reason) => [
    "policy_override", "authorization_change", "credential_request",
    "embedded_tool_directive", "hidden_instruction", "self_promotion_attempt",
    "agent_inference_without_evidence",
  ].includes(reason));
  if (poisoned) return { status: "quarantined", reasons, requiresHumanReview: true };

  if (EXTERNAL_SOURCES.has(input.sourceType)) {
    return { status: "pending", reasons: [...reasons, "external_source_is_evidence"], requiresHumanReview: true };
  }

  const explicitHuman = input.sourceType === "explicit_user_statement" || input.sourceType === "human_correction";
  const lowRisk = input.risk < 0.35 && !reasons.includes("high_risk_domain");
  if (explicitHuman && lowRisk && input.sourceTrust >= 0.85 && input.confidence >= 0.8) {
    return { status: "auto_approved", reasons: ["verified_human_low_risk"], requiresHumanReview: false };
  }
  return { status: "pending", reasons, requiresHumanReview: true };
}
