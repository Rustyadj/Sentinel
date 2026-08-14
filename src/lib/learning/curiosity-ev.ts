// Curiosity Engine upgrade — evidence-driven uncertainty + expected-value
// gating + question-quality scoring.
//
// Extends curiosity.ts (computeCuriosityScore / recordCuriosityEvent stay
// canonical and untouched — every existing call site keeps working exactly
// as before) rather than forking a second curiosity engine. This module
// adds the seven uncertainty dimensions, the EV(clarification) vs.
// cost(interruption) decision, and question-quality scoring the spec asks
// for, storing them in the additive columns added to CuriosityEvent.

import { db } from "@/lib/db";
import {
  computeCuriosityScore,
  recordCuriosityEvent,
  type CuriosityFactors,
  type RecordCuriosityInput,
} from "./curiosity";

export interface UncertaintyDimensions {
  intentUncertainty?: number;
  knowledgeUncertainty?: number;
  preferenceUncertainty?: number;
  goalUncertainty?: number;
  environmentUncertainty?: number;
  riskUncertainty?: number;
  contradictionUncertainty?: number;
}

/**
 * Folds the seven fine-grained uncertainty dimensions into the coarser
 * CuriosityFactors the existing scoring function expects — additive
 * decomposition, not a replacement scoring model. intentUncertainty and
 * goalUncertainty read as ambiguity; knowledgeUncertainty and
 * environmentUncertainty read as novelty (the agent has less grounding);
 * contradictionUncertainty reads as conflict; riskUncertainty and
 * preferenceUncertainty read as business impact.
 */
export function foldUncertaintyIntoFactors(
  dims: UncertaintyDimensions,
  base: CuriosityFactors = {},
): CuriosityFactors {
  const clamp = (v: number | undefined) => (v === undefined ? undefined : Math.min(Math.max(v, 0), 1));
  const avg = (...values: (number | undefined)[]) => {
    const present = values.filter((v): v is number => v !== undefined);
    return present.length ? present.reduce((a, b) => a + b, 0) / present.length : undefined;
  };
  return {
    ...base,
    ambiguityScore: clamp(avg(base.ambiguityScore, dims.intentUncertainty, dims.goalUncertainty)),
    noveltyScore: clamp(avg(base.noveltyScore, dims.knowledgeUncertainty, dims.environmentUncertainty)),
    conflictScore: clamp(avg(base.conflictScore, dims.contradictionUncertainty)),
    businessImpactScore: clamp(avg(base.businessImpactScore, dims.riskUncertainty, dims.preferenceUncertainty)),
  };
}

export interface ExpectedValueInput {
  /** 0..1 — how likely the agent's current assumption is wrong. */
  riskOfWrongAssumption: number;
  /** 0..1 — how hard the action would be to undo if the assumption is wrong. */
  irreversibility: number;
  /** 0..1 — cost imposed on the user by asking (attention, friction). */
  userEffort: number;
  /** 0..1 — current confidence in the assumption (higher = less need to ask). */
  confidence: number;
  /** 0..1 — how important getting this right is. */
  importance: number;
  /** 0..1 — how much relevant evidence is already available (more evidence = less need to ask). */
  availableEvidence: number;
  /** 0..1 — how easily a wrong assumption could be recovered from after the fact. */
  abilityToRecover: number;
}

export interface ExpectedValueResult {
  expectedValueOfClarification: number;
  expectedCostOfInterruption: number;
  shouldConsiderAsking: boolean;
}

/**
 * Computes "Expected Value of Clarification > Expected Cost of Interruption"
 * as a real number, not a threshold-only heuristic — per spec, this is meant
 * to represent the decision computationally so it can be tuned/audited
 * rather than living only inside a prompt.
 */
export function computeExpectedValue(input: ExpectedValueInput): ExpectedValueResult {
  const clamp = (v: number) => Math.min(Math.max(v, 0), 1);
  const risk = clamp(input.riskOfWrongAssumption);
  const irreversibility = clamp(input.irreversibility);
  const importance = clamp(input.importance);
  const confidence = clamp(input.confidence);
  const evidence = clamp(input.availableEvidence);
  const recoverability = clamp(input.abilityToRecover);
  const userEffort = clamp(input.userEffort);

  // Value of asking scales with how likely the assumption is wrong, how bad
  // being wrong would be (irreversibility + importance), and how little
  // evidence already resolves the uncertainty; discounted by how easily a
  // wrong assumption could be recovered from without having asked.
  const expectedValueOfClarification =
    risk * (0.4 * irreversibility + 0.35 * importance + 0.25 * (1 - evidence)) * (1 - 0.5 * recoverability);

  // Cost of interrupting scales with user effort and inversely with how
  // uncertain the agent actually is — a highly confident agent asking
  // anyway imposes cost with little offsetting value.
  const expectedCostOfInterruption = userEffort * (0.5 + 0.5 * confidence);

  return {
    expectedValueOfClarification: Math.round(expectedValueOfClarification * 1000) / 1000,
    expectedCostOfInterruption: Math.round(expectedCostOfInterruption * 1000) / 1000,
    shouldConsiderAsking: expectedValueOfClarification > expectedCostOfInterruption,
  };
}

export interface QuestionQualityInput {
  necessity: number; // 0..1 — how much this actually needs answering to proceed safely
  specificity: number; // 0..1 — how precisely scoped the question is (vs. vague "can you clarify?")
  informationGain: number; // 0..1 — how much the answer would actually change behavior
  userBurden: number; // 0..1 — cost imposed on the user (higher = worse)
  redundancy: number; // 0..1 — how much this overlaps a question already asked/answered (higher = worse)
  /** 0..1 — how well-timed the question is (mid-task interruption scores lower than a natural checkpoint). */
  timing?: number;
}

export interface QuestionQualityResult {
  score: number;
  shouldAsk: boolean;
  reasons: string[];
}

const QUESTION_QUALITY_WEIGHTS = {
  necessity: 0.3,
  specificity: 0.2,
  informationGain: 0.25,
  timing: 0.1,
  userBurden: -0.1,
  redundancy: -0.15,
};

const QUESTION_QUALITY_ASK_THRESHOLD = 0.5;

/**
 * Scores a candidate question independent of whether it gets asked, so the
 * engine can learn when NOT to ask (spec) — a low-quality question (vague,
 * redundant, high-burden, low information gain) is suppressed even if the
 * underlying curiosity score crossed threshold.
 */
export function evaluateQuestionQuality(input: QuestionQualityInput): QuestionQualityResult {
  const clamp = (v: number | undefined) => Math.min(Math.max(v ?? 0, 0), 1);
  const timing = clamp(input.timing ?? 0.7);
  const score =
    clamp(input.necessity) * QUESTION_QUALITY_WEIGHTS.necessity +
    clamp(input.specificity) * QUESTION_QUALITY_WEIGHTS.specificity +
    clamp(input.informationGain) * QUESTION_QUALITY_WEIGHTS.informationGain +
    timing * QUESTION_QUALITY_WEIGHTS.timing +
    clamp(input.userBurden) * QUESTION_QUALITY_WEIGHTS.userBurden +
    clamp(input.redundancy) * QUESTION_QUALITY_WEIGHTS.redundancy;
  const normalized = Math.max(0, Math.min(1, Math.round(score * 1000) / 1000));

  const reasons: string[] = [];
  if (input.necessity < 0.3) reasons.push("low necessity — agent could likely proceed safely without asking");
  if (input.specificity < 0.3) reasons.push("question is too vague to be worth the interruption");
  if (input.redundancy > 0.6) reasons.push("substantially redundant with a question already asked/answered");
  if (input.informationGain < 0.2) reasons.push("answer is unlikely to change behavior materially");

  return { score: normalized, shouldAsk: normalized >= QUESTION_QUALITY_ASK_THRESHOLD, reasons };
}

// --- "Why" questions ------------------------------------------------------

export interface WhyQuestionInput {
  /** Could the answer materially affect future behavior, preference understanding, procedure, workflow, project goals, or decision quality? */
  materiallyAffects: Array<"future_behavior" | "preference" | "procedure" | "workflow" | "project_goals" | "decision_quality">;
  confidence: number;
}

/**
 * Gate for occasional "why are we doing it this way?" questions. Only
 * surfaced when the answer could materially affect something listed —
 * never asked out of idle curiosity (spec: "do not make the agent
 * annoyingly philosophical").
 */
export function shouldAskWhyQuestion(input: WhyQuestionInput): boolean {
  return input.materiallyAffects.length > 0 && input.confidence < 0.7;
}

// --- Combined record + decide ----------------------------------------------

export interface RecordUncertaintyDrivenCuriosityInput
  extends Omit<RecordCuriosityInput, "factors" | "question">,
    UncertaintyDimensions {
  expectedValue?: ExpectedValueInput;
  questionText?: string;
  question?: QuestionQualityInput;
  baseFactors?: CuriosityFactors;
}

/**
 * The full upgraded pipeline: fold uncertainty dimensions into the existing
 * scoring model, record the event through the existing, tested
 * recordCuriosityEvent(), then attach the EV decision and question-quality
 * breakdown as additive columns. A curiosity event only actually surfaces a
 * question when BOTH the curiosity score crosses threshold AND (if an EV
 * input was supplied) EV(clarification) > cost(interruption) AND (if a
 * question was supplied) its quality score clears the ask threshold —
 * three independent gates, any of which can suppress asking.
 */
export async function recordUncertaintyDrivenCuriosity(input: RecordUncertaintyDrivenCuriosityInput) {
  const factors = foldUncertaintyIntoFactors(input, input.baseFactors);
  const base = await recordCuriosityEvent({
    agentId: input.agentId,
    traceId: input.traceId,
    workspaceId: input.workspaceId,
    projectId: input.projectId,
    triggerType: input.triggerType,
    reason: input.reason,
    question: input.questionText,
    factors,
  });

  const ev = input.expectedValue ? computeExpectedValue(input.expectedValue) : null;
  const questionQuality = input.question ? evaluateQuestionQuality(input.question) : null;

  const finalShouldAsk = base.shouldAsk && (ev?.shouldConsiderAsking ?? true) && (questionQuality?.shouldAsk ?? true);

  const event = await db.curiosityEvent.update({
    where: { id: base.event.id },
    data: {
      intentUncertainty: input.intentUncertainty ?? null,
      knowledgeUncertainty: input.knowledgeUncertainty ?? null,
      preferenceUncertainty: input.preferenceUncertainty ?? null,
      goalUncertainty: input.goalUncertainty ?? null,
      environmentUncertainty: input.environmentUncertainty ?? null,
      riskUncertainty: input.riskUncertainty ?? null,
      contradictionUncertainty: input.contradictionUncertainty ?? null,
      expectedValueOfClarification: ev?.expectedValueOfClarification ?? null,
      expectedCostOfInterruption: ev?.expectedCostOfInterruption ?? null,
      questionNecessity: input.question?.necessity ?? null,
      questionSpecificity: input.question?.specificity ?? null,
      questionInformationGain: input.question?.informationGain ?? null,
      questionUserBurden: input.question?.userBurden ?? null,
      questionRedundancy: input.question?.redundancy ?? null,
      questionQualityScore: questionQuality?.score ?? null,
      asked: finalShouldAsk,
      question: finalShouldAsk ? (input.questionText ?? base.event.question) : null,
    },
  });

  return { event, shouldAsk: finalShouldAsk, ev, questionQuality };
}

export { computeCuriosityScore };
