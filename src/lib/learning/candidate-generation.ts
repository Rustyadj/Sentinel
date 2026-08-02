import { db } from "@/lib/db";
import { proposeCandidate } from "@/lib/neural-engine/learning-service";
import type { LearningCandidateType, RiskLevel } from "@/lib/neural-engine/types";

export interface GenerateCandidateFromGoalInput {
  learningGoalId: string;
  type: LearningCandidateType;
  proposedPayload: Record<string, unknown>;
  targetType?: string;
  /** Required — "no candidate may advance without a clear testable hypothesis" (spec). */
  testPlan: Record<string, unknown>;
  rollbackCriteria?: Record<string, unknown>;
  rolloutPlan?: Record<string, unknown>;
  riskLevel?: RiskLevel;
  evidenceCount?: number;
  confidence?: number;
}

export async function generateCandidateFromLearningGoal(input: GenerateCandidateFromGoalInput) {
  if (!input.testPlan || Object.keys(input.testPlan).length === 0) {
    throw new Error("A candidate cannot be proposed without a test plan.");
  }

  const goal = await db.learningGoal.findUniqueOrThrow({ where: { id: input.learningGoalId } });

  // Reuses the existing LearningCandidate pipeline (risk classification,
  // auto-approve eligibility, ApprovalRequest linkage) — this is
  // deliberately not a parallel candidate-creation path.
  const result = await proposeCandidate({
    type: input.type,
    proposedPayload: input.proposedPayload,
    targetType: input.targetType,
    riskLevel: input.riskLevel,
    evidenceCount: input.evidenceCount,
    confidence: input.confidence,
    knowledgeGapId: goal.knowledgeGapId,
    problem: goal.objective,
    testPlan: input.testPlan,
    rollbackCriteria: input.rollbackCriteria,
    rolloutPlan: input.rolloutPlan,
  });

  await db.learningGoal.update({ where: { id: goal.id }, data: { status: "active" } });

  return result;
}

export async function listCandidatesForGoal(learningGoalId: string) {
  const goal = await db.learningGoal.findUniqueOrThrow({ where: { id: learningGoalId } });
  if (!goal.knowledgeGapId) return [];
  return db.learningCandidate.findMany({
    where: { knowledgeGapId: goal.knowledgeGapId },
    orderBy: { createdAt: "desc" },
  });
}
