import { db } from "@/lib/db";
import { emitLearningEvent } from "./event-service";
import { type AccessibleLearningScope, buildLearningScopeWhere } from "./authorization";

// Weighted scoring model — adapted from the original spec's formula to the
// fields actually on CuriosityEvent (schema has ambiguity/novelty/conflict/
// businessImpact/urgency, not separate irreversibility/correctionHistory
// terms; urgency absorbs that remaining weight). Weights sum to 1.0.
const WEIGHTS = {
  uncertainty: 0.2, // derived from (1 - confidenceBefore)
  ambiguity: 0.22,
  conflict: 0.18,
  novelty: 0.12,
  businessImpact: 0.12,
  urgency: 0.16,
} as const;

// Below this, an agent should still guess rather than interrupt — asking
// about every minor uncertainty defeats the point of asking at all.
export const CURIOSITY_ASK_THRESHOLD = 0.6;

// Don't re-ask the same thing on every turn — suppress a repeat question
// for the same agent within this window unless the earlier one was resolved.
const SUPPRESS_REPEAT_WINDOW_MS = 30 * 60 * 1000;

export interface CuriosityFactors {
  confidenceBefore?: number; // 0-1, higher = more confident (uncertainty = 1 - this)
  ambiguityScore?: number; // 0-1
  noveltyScore?: number; // 0-1
  conflictScore?: number; // 0-1 — contradicts existing memory/context
  businessImpactScore?: number; // 0-1
  urgencyScore?: number; // 0-1 — also standing in for irreversibility/repeated-correction weight
}

export function computeCuriosityScore(factors: CuriosityFactors): number {
  const uncertainty = 1 - Math.min(Math.max(factors.confidenceBefore ?? 1, 0), 1);
  const clamp = (v: number | undefined) => Math.min(Math.max(v ?? 0, 0), 1);
  const score =
    uncertainty * WEIGHTS.uncertainty +
    clamp(factors.ambiguityScore) * WEIGHTS.ambiguity +
    clamp(factors.conflictScore) * WEIGHTS.conflict +
    clamp(factors.noveltyScore) * WEIGHTS.novelty +
    clamp(factors.businessImpactScore) * WEIGHTS.businessImpact +
    clamp(factors.urgencyScore) * WEIGHTS.urgency;
  return Math.round(Math.min(score, 1) * 100) / 100;
}

export interface RecordCuriosityInput {
  agentId: string;
  traceId?: string;
  workspaceId?: string;
  projectId?: string;
  triggerType: string; // ambiguous_goal, missing_constraint, unusual_decision, conflicting_memory, unknown_term, low_confidence, repeated_user_correction, unexpected_result, incomplete_context, hidden_business_goal, preference_uncertainty
  reason?: string;
  question?: string;
  factors: CuriosityFactors;
}

export interface RecordCuriosityResult {
  event: Awaited<ReturnType<typeof db.curiosityEvent.create>>;
  shouldAsk: boolean;
}

// Records every curiosity decision, including when the engine decides NOT to
// ask (per the spec: "Store every curiosity decision") — `asked` reflects
// whether the score crossed threshold AND wasn't suppressed as a recent repeat.
export async function recordCuriosityEvent(input: RecordCuriosityInput): Promise<RecordCuriosityResult> {
  const curiosityScore = computeCuriosityScore(input.factors);
  const crossesThreshold = curiosityScore >= CURIOSITY_ASK_THRESHOLD;

  let suppressed = false;
  if (crossesThreshold) {
    const recentUnresolved = await db.curiosityEvent.findFirst({
      where: {
        agentId: input.agentId,
        triggerType: input.triggerType,
        asked: true,
        answered: false,
        createdAt: { gte: new Date(Date.now() - SUPPRESS_REPEAT_WINDOW_MS) },
      },
    });
    suppressed = recentUnresolved !== null;
  }

  const shouldAsk = crossesThreshold && !suppressed;

  const event = await db.curiosityEvent.create({
    data: {
      traceId: input.traceId ?? null,
      agentId: input.agentId,
      workspaceId: input.workspaceId ?? null,
      projectId: input.projectId ?? null,
      triggerType: input.triggerType,
      question: shouldAsk ? (input.question ?? null) : null,
      reason: input.reason ?? null,
      confidenceBefore: input.factors.confidenceBefore ?? null,
      ambiguityScore: input.factors.ambiguityScore ?? null,
      noveltyScore: input.factors.noveltyScore ?? null,
      conflictScore: input.factors.conflictScore ?? null,
      businessImpactScore: input.factors.businessImpactScore ?? null,
      urgencyScore: input.factors.urgencyScore ?? null,
      curiosityScore,
      asked: shouldAsk,
    },
  });

  void emitLearningEvent({
    eventType: shouldAsk ? "clarification_requested" : "low_confidence_answer",
    sourceType: "curiosity",
    sourceId: event.id,
    agentId: input.agentId,
    traceId: input.traceId,
    workspaceId: input.workspaceId,
    payload: { curiosityScore, triggerType: input.triggerType, suppressed },
  }).catch((err) => console.error("[learning] emitLearningEvent failed (non-fatal):", err));

  return { event, shouldAsk };
}

export async function answerCuriosityEvent(id: string, answerSummary: string, outcome?: string) {
  const event = await db.curiosityEvent.update({
    where: { id },
    data: { answered: true, answerSummary, outcome: outcome ?? null, answeredAt: new Date() },
  });
  void emitLearningEvent({
    eventType: "clarification_answered",
    sourceType: "curiosity",
    sourceId: event.id,
    agentId: event.agentId,
    traceId: event.traceId ?? undefined,
    payload: { outcome: outcome ?? null },
  }).catch((err) => console.error("[learning] emitLearningEvent failed (non-fatal):", err));
  return event;
}

export interface CuriosityContextInput {
  agentId: string;
  userContent: string;
  knowledgeObjectIds: string[];
}

export interface CuriosityContextResult {
  factors: CuriosityFactors;
  triggerType: string;
  reason: string;
}

const IMPACT_KEYWORDS = /\b(production|delete|deleting|permanently|irreversible|everyone|all users|customer[s]?|database|payment|billing|credentials?|security)\b/i;
const URGENCY_KEYWORDS = /\b(urgent|asap|immediately|right now|critical|emergency)\b/i;
const VAGUE_REFERENT = /\b(it|that|this|again|same|the usual|like before|like last time)\b/i;

// Real, data-driven pre-execution signal — not an LLM call (see intent.ts
// for why) and not fabricated: every factor here comes from an actual DB
// query or a documented heuristic over the live message text, not a
// hardcoded placeholder. Genuinely approximate; documented as such.
export async function analyzeCuriosityContext(input: CuriosityContextInput): Promise<CuriosityContextResult> {
  const wordCount = input.userContent.trim().split(/\s+/).filter(Boolean).length;
  const hasVagueReferent = VAGUE_REFERENT.test(input.userContent);
  const gotNoRetrieval = input.knowledgeObjectIds.length === 0;

  const ambiguityScore = Math.min(
    (wordCount < 6 ? 0.5 : wordCount < 12 ? 0.2 : 0) + (hasVagueReferent && gotNoRetrieval ? 0.3 : 0),
    1
  );

  const openConflict = input.knowledgeObjectIds.length
    ? await db.claim.findFirst({
        where: { sourceId: { in: input.knowledgeObjectIds }, contradiction: { status: "open" } },
      })
    : null;
  const conflictScore = openConflict ? 0.8 : 0;

  const experienceCount = await db.experience.count({ where: { agentId: input.agentId } });
  const noveltyScore = experienceCount < 3 ? 0.7 : experienceCount < 10 ? 0.4 : 0.1;

  const businessImpactScore = IMPACT_KEYWORDS.test(input.userContent) ? 0.7 : 0.1;
  const urgencyScore = URGENCY_KEYWORDS.test(input.userContent) ? 0.6 : 0.1;

  const recentCorrection = await db.reflection.findFirst({
    where: { agentId: input.agentId, shouldAskNextTime: true },
    orderBy: { createdAt: "desc" },
  });
  const confidenceBefore = recentCorrection ? 0.4 : 0.75;

  const factors: CuriosityFactors = {
    confidenceBefore,
    ambiguityScore,
    conflictScore,
    noveltyScore,
    businessImpactScore,
    urgencyScore,
  };

  let triggerType = "incomplete_context";
  let reason = `word count ${wordCount}, ${input.knowledgeObjectIds.length} retrieved objects`;
  if (conflictScore > 0) {
    triggerType = "conflicting_memory";
    reason = "retrieved context includes an unresolved contradiction";
  } else if (recentCorrection) {
    triggerType = "repeated_user_correction";
    reason = "a recent reflection flagged that this agent should ask more before acting";
  } else if (ambiguityScore >= 0.5) {
    triggerType = "ambiguous_goal";
    reason = "short message with a vague referent and no grounding retrieval";
  } else if (businessImpactScore >= 0.7 || urgencyScore >= 0.6) {
    triggerType = "hidden_business_goal";
    reason = "message touches a high-impact or urgent keyword";
  }

  return { factors, triggerType, reason };
}

export async function listCuriosityEvents(params?: {
  agentId?: string;
  askedOnly?: boolean;
  unansweredOnly?: boolean;
  limit?: number;
  scope?: AccessibleLearningScope;
}) {
  return db.curiosityEvent.findMany({
    where: {
      ...(params?.agentId ? { agentId: params.agentId } : {}),
      ...(params?.askedOnly ? { asked: true } : {}),
      ...(params?.unansweredOnly ? { asked: true, answered: false } : {}),
      ...(params?.scope
        ? buildLearningScopeWhere(params.scope, { workspaceId: true, projectId: true, agentId: true })
        : {}),
    },
    orderBy: { createdAt: "desc" },
    take: params?.limit ?? 50,
  });
}
