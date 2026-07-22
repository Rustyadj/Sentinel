// Sentinel Neural Engine — Skill & Procedure promotion (Layer 2 / Phase E seed)
//
// Repeated successful action sequences become reusable Skills/Procedures —
// but only past a real threshold. A single successful run is never enough.

import { db } from "@/lib/db";
import type { Prisma } from "@prisma/client";
import { emitNeuralEvent } from "./event-service";

function toJson(value: unknown): Prisma.InputJsonValue {
  return (value ?? {}) as Prisma.InputJsonValue;
}

export const MIN_PROMOTION_EVIDENCE_COUNT = 3;
export const MIN_PROMOTION_SUCCESS_RATE = 0.75;
export const MIN_PROMOTION_DISTINCT_TASKS = 2;
export const MIN_PROMOTION_EVALUATOR_CONFIDENCE = 0.7;

export interface PromotionEvidence {
  evidenceCount: number;
  successRate: number;
  distinctTaskCount: number;
  evaluatorConfidence: number;
  hasUnresolvedSafetyFailure: boolean;
}

export interface PromotionCheck {
  eligible: boolean;
  reasons: string[];
}

/** Pure function — no DB access — so promotion policy is unit-testable in isolation. */
export function checkPromotionEligibility(evidence: PromotionEvidence): PromotionCheck {
  const reasons: string[] = [];

  if (evidence.evidenceCount < MIN_PROMOTION_EVIDENCE_COUNT) {
    reasons.push(
      `evidenceCount ${evidence.evidenceCount} < required ${MIN_PROMOTION_EVIDENCE_COUNT}`,
    );
  }
  if (evidence.successRate < MIN_PROMOTION_SUCCESS_RATE) {
    reasons.push(
      `successRate ${evidence.successRate} < required ${MIN_PROMOTION_SUCCESS_RATE}`,
    );
  }
  if (evidence.distinctTaskCount < MIN_PROMOTION_DISTINCT_TASKS) {
    reasons.push(
      `distinctTaskCount ${evidence.distinctTaskCount} < required ${MIN_PROMOTION_DISTINCT_TASKS} (must be stable across multiple tasks, not one lucky run)`,
    );
  }
  if (evidence.evaluatorConfidence < MIN_PROMOTION_EVALUATOR_CONFIDENCE) {
    reasons.push(
      `evaluatorConfidence ${evidence.evaluatorConfidence} < required ${MIN_PROMOTION_EVALUATOR_CONFIDENCE}`,
    );
  }
  if (evidence.hasUnresolvedSafetyFailure) {
    reasons.push("has an unresolved safety failure");
  }

  return { eligible: reasons.length === 0, reasons };
}

export interface SkillPayload {
  name: string;
  description: string;
  domain: string;
  steps?: unknown[];
  requiredTools?: string[];
  constraints?: Record<string, unknown>;
  successMetrics?: Record<string, unknown>;
  evidenceLinks?: string[];
  owner?: string;
  evidence: PromotionEvidence;
}

/**
 * Promote a Skill or Procedure from a LearningCandidate payload. Re-checks
 * the threshold itself — approval of the LearningCandidate is necessary but
 * not sufficient; this is the actual promotion gate.
 */
export async function promoteFromPayload(
  kind: "skill" | "procedure",
  payload: Record<string, unknown>,
) {
  const p = payload as unknown as SkillPayload;
  const check = checkPromotionEligibility(p.evidence);
  if (!check.eligible) {
    throw new Error(
      `Refusing to promote ${kind} "${p.name}": ${check.reasons.join("; ")}`,
    );
  }

  const data = {
    name: p.name,
    description: p.description,
    domain: p.domain,
    steps: toJson(p.steps ?? []),
    requiredTools: p.requiredTools ?? [],
    constraints: toJson(p.constraints ?? {}),
    successMetrics: toJson(p.successMetrics ?? {}),
    evidenceLinks: p.evidenceLinks ?? [],
    owner: p.owner ?? null,
    status: "active",
  };

  const created =
    kind === "skill" ? await db.skill.create({ data }) : await db.procedure.create({ data });

  await emitNeuralEvent({
    type: "skill.promoted",
    payload: { id: created.id, kind, name: p.name, domain: p.domain },
  });

  return created;
}

export async function listSkills(domain?: string) {
  return db.skill.findMany({
    where: { status: "active", ...(domain ? { domain } : {}) },
    orderBy: { updatedAt: "desc" },
  });
}

export async function listProcedures(domain?: string) {
  return db.procedure.findMany({
    where: { status: "active", ...(domain ? { domain } : {}) },
    orderBy: { updatedAt: "desc" },
  });
}

export async function deprecateSkill(id: string, kind: "skill" | "procedure") {
  if (kind === "skill") {
    return db.skill.update({ where: { id }, data: { status: "deprecated" } });
  }
  return db.procedure.update({ where: { id }, data: { status: "deprecated" } });
}
