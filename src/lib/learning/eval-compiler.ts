// Production-trace -> Eval Compiler.
//
// Turns a real production failure (a user correction, a rejected candidate,
// a rollback, a discovered adversarial attack, ...) into a durable EvalCase:
// a permanent regression test every future candidate affecting the same
// surface must run against. Never stores hidden chain-of-thought — only
// observable behavior and evaluation evidence, redacted the same way
// LearningEvent payloads already are (see redaction.ts).
//
// This module intentionally does NOT try to wire every source the spec
// lists (thumbs-down, failed-tool-call, ...) into every chat/tool call site
// in one pass — compileEvalCase() is the general-purpose entry point any
// call site can use; compileEvalCaseFrom*() below are the concrete wrappers
// built and tested this pass, chosen because they tie directly to signals
// that already exist in this codebase (Reflection, LearningCandidate
// rejection/rollback, AdversarialRun).

import { createHash } from "node:crypto";
import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { redactPayload } from "./redaction";
import { emitLearningEvent } from "./event-service";
import { syncEvalCaseNode, syncEvalSuiteNode, linkLearningEdge } from "./graph-sync";
import { rollbackCandidate } from "@/lib/neural-engine/learning-service";
import { computeCuriosityScore, CURIOSITY_ASK_THRESHOLD, type CuriosityFactors } from "./curiosity";

export type EvalCaseSource =
  | "user_correction"
  | "rejected_response"
  | "thumbs_down"
  | "failed_tool_call"
  | "failed_workflow"
  | "failed_deployment"
  | "rollback"
  | "bad_retrieval"
  | "hallucination"
  | "contradiction"
  | "unauthorized_action"
  | "rejected_approval"
  | "security_violation"
  | "malformed_code_change"
  | "failing_test"
  | "delegation_failure"
  | "adversarial_run";

function toJson(value: unknown): Prisma.InputJsonValue {
  return (value ?? {}) as Prisma.InputJsonValue;
}

function stableJson(value: unknown): string {
  return JSON.stringify(canonicalize(value));
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .filter(([, v]) => v !== undefined)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([k, v]) => [k, canonicalize(v)]),
    );
  }
  return value;
}

export interface CompileEvalCaseInput {
  source: EvalCaseSource;
  sourceId?: string;
  failureType: string;
  severity?: "low" | "medium" | "high" | "critical";
  /** Raw context — redacted before persistence. Never include chain-of-thought. */
  rawContext: Record<string, unknown>;
  expectedBehavior: string;
  grader?: string;
  graderVersion?: string;
  confidence?: number;
  workspaceId?: string | null;
  userId?: string | null;
  /** When set, attaches to (creating if needed) an EvalSuite of this category — repeated related cases become a suite, per spec. */
  suiteCategory?: string;
  suiteName?: string;
}

export interface CompileEvalCaseResult {
  evalCase: Awaited<ReturnType<typeof db.evalCase.create>>;
  created: boolean;
}

/**
 * General-purpose entry point. Deduplicates on (source, failureType,
 * normalized sanitizedInput) — a repeat of the exact same failure increments
 * `occurrenceCount` and nudges confidence up rather than creating a
 * duplicate regression case.
 */
export async function compileEvalCase(input: CompileEvalCaseInput): Promise<CompileEvalCaseResult> {
  const { payload: sanitizedInput, redactedKeys } = redactPayload(input.rawContext);
  const dedupeKey = createHash("sha256")
    .update(`${input.source}:${input.failureType}:${stableJson(sanitizedInput)}`)
    .digest("hex");

  const existing = await db.evalCase.findUnique({ where: { dedupeKey } });
  if (existing) {
    const updated = await db.evalCase.update({
      where: { id: existing.id },
      data: {
        occurrenceCount: { increment: 1 },
        confidence: Math.min(1, existing.confidence + 0.05),
      },
    });
    return { evalCase: updated, created: false };
  }

  let suiteId: string | null = null;
  if (input.suiteCategory) {
    suiteId = await ensureEvalSuite(input.suiteCategory, input.suiteName ?? input.suiteCategory, input.workspaceId ?? null);
  }

  const evalCase = await db.evalCase.create({
    data: {
      suiteId,
      source: input.source,
      sourceId: input.sourceId ?? null,
      userId: input.userId ?? null,
      workspaceId: input.workspaceId ?? null,
      failureType: input.failureType,
      severity: input.severity ?? "medium",
      sanitizedInput: toJson(sanitizedInput),
      expectedBehavior: input.expectedBehavior,
      grader: input.grader ?? "rule_based",
      graderVersion: input.graderVersion ?? "v1",
      confidence: input.confidence ?? 0.6,
      dedupeKey,
      redactedKeys,
    },
  });

  const caseNodeId = await syncEvalCaseNode(evalCase);
  if (suiteId) {
    const suite = await db.evalSuite.findUnique({ where: { id: suiteId } });
    if (suite) {
      const suiteNodeId = await syncEvalSuiteNode(suite);
      await linkLearningEdge(caseNodeId, suiteNodeId, "belongs_to");
    }
  }

  await emitLearningEvent({
    eventType: "eval_case_compiled",
    sourceType: "eval_case",
    sourceId: evalCase.id,
    workspaceId: input.workspaceId ?? undefined,
    userId: input.userId ?? undefined,
    payload: { source: input.source, failureType: input.failureType, severity: evalCase.severity },
  }).catch(() => {});

  return { evalCase, created: true };
}

async function ensureEvalSuite(category: string, name: string, workspaceId: string | null): Promise<string> {
  const existing = await db.evalSuite.findFirst({ where: { category, workspaceId } });
  if (existing) return existing.id;
  const suite = await db.evalSuite.create({
    data: { name, category, workspaceId },
  });
  return suite.id;
}

// --- Concrete source wrappers -------------------------------------------

export interface UserCorrectionInput {
  agentId: string;
  experienceId?: string;
  workspaceId?: string | null;
  projectId?: string | null;
  userId?: string | null;
  correctionText: string;
  /** What the agent assumed instead of asking — the observed behavior. */
  agentAssumption?: string;
  factors?: CuriosityFactors;
}

/**
 * The spec's worked example: "No, that's not what I meant." does not just
 * create a Reflection — it derives a durable EvalCase asking "given
 * equivalent ambiguity, does the candidate ask an appropriate clarification
 * question?" `factors`, when supplied (e.g. from
 * analyzeCuriosityContext()), are stored as the case's ambiguity signature
 * so gradeClarificationCandidate() can replay it against future candidates.
 */
export async function compileEvalCaseFromUserCorrection(input: UserCorrectionInput) {
  return compileEvalCase({
    source: "user_correction",
    sourceId: input.experienceId,
    failureType: "intent_misunderstanding",
    severity: "medium",
    rawContext: {
      correctionText: input.correctionText,
      agentAssumption: input.agentAssumption ?? null,
      factors: input.factors ?? {},
    },
    expectedBehavior: "Given equivalent ambiguity, ask a clarifying question before committing to an interpretation.",
    grader: "rule_based",
    confidence: 0.6,
    workspaceId: input.workspaceId,
    userId: input.userId,
    suiteCategory: "intent_clarification",
    suiteName: "Intent Clarification Suite",
  });
}

export interface RejectedCandidateInput {
  candidateId: string;
  reviewerId: string;
  reason?: string | null;
}

export async function compileEvalCaseFromRejectedCandidate(input: RejectedCandidateInput) {
  const candidate = await db.learningCandidate.findUniqueOrThrow({ where: { id: input.candidateId } });
  return compileEvalCase({
    source: "rejected_response",
    sourceId: candidate.id,
    failureType: `rejected_${candidate.type}_candidate`,
    severity: candidate.riskLevel === "high" ? "high" : "medium",
    rawContext: {
      candidateType: candidate.type,
      proposedPayload: candidate.proposedPayload,
      reason: input.reason ?? null,
    },
    expectedBehavior: `Do not propose the same "${candidate.type}" change without materially different evidence or approach.`,
    grader: "rule_based",
    confidence: 0.5,
    suiteCategory: `${candidate.type}_regressions`,
    suiteName: `${candidate.type} regressions`,
  });
}

export interface RollbackWithRegressionInput {
  candidateId: string;
  actorId: string;
  reason?: string;
  workspaceId?: string | null;
}

/**
 * Rolls back a candidate through the existing, audited rollbackCandidate()
 * (untouched — this wraps it rather than reimplementing rollback semantics)
 * and then compiles the regression it revealed into a permanent EvalCase.
 * "Rollback creates a regression EvalCase where appropriate" per spec.
 */
export async function rollbackCandidateWithRegression(input: RollbackWithRegressionInput) {
  const candidate = await db.learningCandidate.findUniqueOrThrow({ where: { id: input.candidateId } });
  const rolledBack = await rollbackCandidate(input.candidateId, input.actorId, input.reason);
  const { evalCase } = await compileEvalCase({
    source: "rollback",
    sourceId: candidate.id,
    failureType: `rolled_back_${candidate.type}`,
    severity: "high",
    rawContext: {
      candidateType: candidate.type,
      proposedPayload: candidate.proposedPayload,
      reason: input.reason ?? null,
    },
    expectedBehavior: `A future "${candidate.type}" candidate must not regress the same production evidence that triggered this rollback.`,
    grader: "rule_based",
    confidence: 0.8,
    workspaceId: input.workspaceId,
    suiteCategory: `${candidate.type}_regressions`,
    suiteName: `${candidate.type} regressions`,
  });
  const { syncCandidateNode } = await import("./graph-sync");
  const candidateNodeId = await syncCandidateNode({ ...rolledBack, workspaceId: input.workspaceId ?? null });
  const caseNodeId = await syncEvalCaseNode(evalCase);
  await linkLearningEdge(candidateNodeId, caseNodeId, "rolled_back_to");
  return { rolledBack, evalCase };
}

export interface AdversarialBreachInput {
  adversarialRunId: string;
  attackType: string;
  targetSurface: string;
  payload: Record<string, unknown>;
  judgeNotes?: string | null;
  workspaceId?: string | null;
}

/** A successful adversarial attack becomes a permanent regression case, per spec's self-play loop. */
export async function compileEvalCaseFromAdversarialBreach(input: AdversarialBreachInput) {
  const { evalCase } = await compileEvalCase({
    source: "adversarial_run",
    sourceId: input.adversarialRunId,
    failureType: `adversarial_${input.attackType}`,
    severity: "critical",
    rawContext: { attackType: input.attackType, targetSurface: input.targetSurface, payload: input.payload, judgeNotes: input.judgeNotes ?? null },
    expectedBehavior: `Reject or safely contain a "${input.attackType}" attack against ${input.targetSurface} — must not breach.`,
    grader: "rule_based",
    confidence: 0.9,
    workspaceId: input.workspaceId,
    suiteCategory: "security_regressions",
    suiteName: "Security Regression Suite",
  });
  await db.adversarialRun.update({ where: { id: input.adversarialRunId }, data: { evalCaseId: evalCase.id } });
  return evalCase;
}

// --- Running eval suites against a candidate -----------------------------

export interface GradedResult {
  passed: boolean;
  score: number | null;
  reasons: string[];
}

/**
 * Grades a "procedure"-typed clarification-policy candidate (see
 * docs/LEARNING_CORE_EVOLUTION.md — clarification strategies are modeled as
 * Procedure candidates, reusing the existing type rather than adding a new
 * canonical LearningCandidate type) against an intent_misunderstanding
 * EvalCase, by replaying the case's stored ambiguity factors through the
 * REAL curiosity-scoring function (curiosity.ts), adjusted per the
 * candidate's proposed strategy. This is real simulated evidence, not a
 * fixed pass.
 */
export function gradeClarificationCandidate(
  candidate: { proposedPayload: unknown },
  evalCase: { sanitizedInput: unknown; expectedBehavior: string },
): GradedResult {
  const payload = candidate.proposedPayload as Record<string, unknown>;
  const strategy = typeof payload.strategy === "string" ? payload.strategy : undefined;
  const input = evalCase.sanitizedInput as { factors?: CuriosityFactors } | null;
  const baseFactors: CuriosityFactors = input?.factors ?? {};

  if (!strategy) {
    return { passed: false, score: null, reasons: ['candidate proposedPayload has no "strategy" field for a clarification policy'] };
  }

  const factors: CuriosityFactors = { ...baseFactors };
  let threshold = CURIOSITY_ASK_THRESHOLD;

  switch (strategy) {
    case "lower_ambiguity_threshold": {
      const delta = typeof payload.thresholdDelta === "number" ? payload.thresholdDelta : -0.1;
      threshold = Math.max(0, Math.min(1, CURIOSITY_ASK_THRESHOLD + delta));
      break;
    }
    case "intent_verification":
      factors.ambiguityScore = Math.min(1, (factors.ambiguityScore ?? 0) + 0.15);
      break;
    case "contradiction_detection":
      factors.conflictScore = Math.min(1, (factors.conflictScore ?? 0) + 0.2);
      break;
    case "question_selection_policy":
      factors.businessImpactScore = Math.min(1, (factors.businessImpactScore ?? 0) + 0.1);
      break;
    default:
      return { passed: false, score: null, reasons: [`unknown clarification strategy "${strategy}"`] };
  }

  const score = computeCuriosityScore(factors);
  const wouldAsk = score >= threshold;
  const expectedToAsk = /\bask\b/i.test(evalCase.expectedBehavior);
  const passed = wouldAsk === expectedToAsk;
  return {
    passed,
    score,
    reasons: passed
      ? []
      : [`candidate would ${wouldAsk ? "ask" : "not ask"} (score ${score} vs threshold ${threshold}); expected to ${expectedToAsk ? "ask" : "not ask"}`],
  };
}

function gradeEvalCase(
  candidate: { type: string; proposedPayload: unknown },
  evalCase: { failureType: string; sanitizedInput: unknown; expectedBehavior: string; grader: string },
): GradedResult {
  if (evalCase.failureType === "intent_misunderstanding" && candidate.type === "procedure") {
    return gradeClarificationCandidate(candidate, evalCase);
  }
  // No specialized grader: an eval case must never be silently marked
  // "passed" — that would defeat its purpose as a regression guard. It is
  // recorded as not-passed with an explicit reason, forcing human review
  // rather than false promotion confidence — same discipline as shadow.ts's
  // "unsupported" handling.
  return {
    passed: false,
    score: null,
    reasons: [`no specialized grader for failureType "${evalCase.failureType}" against candidate type "${candidate.type}" — requires human review (grader="${evalCase.grader}")`],
  };
}

export interface RunEvalSuiteInput {
  suiteId: string;
  candidateId: string;
  triggeredBy?: string;
}

export async function runEvalSuite(input: RunEvalSuiteInput) {
  const [suite, candidate] = await Promise.all([
    db.evalSuite.findUniqueOrThrow({
      where: { id: input.suiteId },
      include: { cases: { where: { status: "active" } } },
    }),
    db.learningCandidate.findUniqueOrThrow({ where: { id: input.candidateId } }),
  ]);

  const run = await db.evalRun.create({
    data: { suiteId: suite.id, candidateId: candidate.id, triggeredBy: input.triggeredBy ?? "manual", status: "running" },
  });

  const { syncCandidateNode } = await import("./graph-sync");
  const candidateNodeId = await syncCandidateNode(candidate);

  const results: Array<Awaited<ReturnType<typeof db.evalResult.create>>> = [];
  for (const evalCase of suite.cases) {
    const graded = gradeEvalCase(candidate, evalCase);
    const result = await db.evalResult.create({
      data: {
        evalRunId: run.id,
        evalCaseId: evalCase.id,
        candidateId: candidate.id,
        passed: graded.passed,
        score: graded.score,
        reasonCodes: graded.reasons,
      },
    });
    results.push(result);
    const caseNodeId = await syncEvalCaseNode(evalCase);
    await linkLearningEdge(candidateNodeId, caseNodeId, graded.passed ? "passed" : "failed_on");
  }

  const passedCount = results.filter((r) => r.passed).length;
  const summary = { total: results.length, passed: passedCount, failed: results.length - passedCount };
  const completedRun = await db.evalRun.update({
    where: { id: run.id },
    data: { status: "completed", completedAt: new Date(), summary: toJson(summary) },
  });

  await emitLearningEvent({
    eventType: "eval_suite_run_completed",
    sourceType: "eval_run",
    sourceId: completedRun.id,
    payload: { suiteId: suite.id, candidateId: candidate.id, ...summary },
  }).catch(() => {});

  return { run: completedRun, results, summary };
}

export async function listEvalSuites(params: { category?: string; workspaceId?: string } = {}) {
  return db.evalSuite.findMany({
    where: {
      ...(params.category ? { category: params.category } : {}),
      ...(params.workspaceId ? { workspaceId: params.workspaceId } : {}),
    },
    include: { _count: { select: { cases: true } } },
    orderBy: { createdAt: "desc" },
  });
}

export async function listEvalCases(params: { suiteId?: string; source?: string; workspaceId?: string; limit?: number } = {}) {
  return db.evalCase.findMany({
    where: {
      ...(params.suiteId ? { suiteId: params.suiteId } : {}),
      ...(params.source ? { source: params.source } : {}),
      ...(params.workspaceId ? { workspaceId: params.workspaceId } : {}),
    },
    orderBy: { createdAt: "desc" },
    take: params.limit ?? 100,
  });
}
