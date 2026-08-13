import { afterAll, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import {
  compileEvalCase,
  compileEvalCaseFromUserCorrection,
  rollbackCandidateWithRegression,
  gradeClarificationCandidate,
} from "@/lib/learning/eval-compiler";
import { uid, makeKnowledgeObject } from "../neural-engine/db-setup";

afterAll(async () => {
  await db.$disconnect();
});

describe("Eval Compiler", () => {
  it("a user correction compiles into a durable EvalCase in the Intent Clarification suite", async () => {
    const { evalCase, created } = await compileEvalCaseFromUserCorrection({
      agentId: uid("agent"),
      correctionText: `No, that's not what I meant. ${uid("nonce")}`,
      agentAssumption: "Assumed the user wanted a full rewrite",
      factors: { ambiguityScore: 0.6, confidenceBefore: 0.4 },
    });
    expect(created).toBe(true);
    expect(evalCase.failureType).toBe("intent_misunderstanding");
    expect(evalCase.expectedBehavior).toMatch(/clarif/i);

    const suite = await db.evalSuite.findUnique({ where: { id: evalCase.suiteId! } });
    expect(suite?.category).toBe("intent_clarification");
  });

  it("duplicate failures deduplicate — same source/failureType/context increments occurrenceCount instead of creating a second row", async () => {
    const rawContext = { correctionText: `duplicate test ${uid("nonce")}` };
    const first = await compileEvalCase({
      source: "user_correction",
      failureType: "intent_misunderstanding",
      rawContext,
      expectedBehavior: "ask a clarifying question",
    });
    const second = await compileEvalCase({
      source: "user_correction",
      failureType: "intent_misunderstanding",
      rawContext,
      expectedBehavior: "ask a clarifying question",
    });
    expect(first.created).toBe(true);
    expect(second.created).toBe(false);
    expect(second.evalCase.id).toBe(first.evalCase.id);
    expect(second.evalCase.occurrenceCount).toBe(2);

    const count = await db.evalCase.count({ where: { id: first.evalCase.id } });
    expect(count).toBe(1);
  });

  it("sensitive content is redacted before persistence — never stores raw secrets", async () => {
    const { evalCase } = await compileEvalCase({
      source: "failed_tool_call",
      failureType: `secret_leak_${uid("nonce")}`,
      rawContext: { apiKey: "sk-super-secret-value", note: "safe text" },
      expectedBehavior: "never echo credentials",
    });
    const sanitized = evalCase.sanitizedInput as Record<string, unknown>;
    expect(sanitized.apiKey).toBe("[REDACTED]");
    expect(sanitized.note).toBe("safe text");
    expect(evalCase.redactedKeys).toContain("apiKey");
  });

  it("a rollback creates a permanent regression EvalCase", async () => {
    const target = await makeKnowledgeObject();
    const candidate = await db.learningCandidate.create({
      data: {
        type: "confidence_update",
        proposedPayload: { agentId: uid("agent"), knowledgeObjectId: target.id, outcome: "success" },
        status: "auto_approved",
        riskLevel: "low",
      },
    });
    const { rolledBack, evalCase } = await rollbackCandidateWithRegression({
      candidateId: candidate.id,
      actorId: "system:test",
      reason: "regressed evidence",
    });
    expect(rolledBack.status).toBe("rolled_back");
    expect(evalCase.source).toBe("rollback");
    expect(evalCase.failureType).toBe(`rolled_back_${candidate.type}`);

    const persisted = await db.evalCase.findUnique({ where: { id: evalCase.id } });
    expect(persisted).not.toBeNull();
  });

  it("grades a clarification-policy candidate by replaying its stored ambiguity factors through real curiosity scoring", () => {
    const askingCandidate = { proposedPayload: { strategy: "lower_ambiguity_threshold", thresholdDelta: -0.5 } };
    const evalCase = {
      sanitizedInput: { factors: { ambiguityScore: 0.9, confidenceBefore: 0.2 } },
      expectedBehavior: "ask a clarifying question before committing to an interpretation",
    };
    const graded = gradeClarificationCandidate(askingCandidate, evalCase);
    expect(graded.passed).toBe(true);

    const unknownStrategy = gradeClarificationCandidate(
      { proposedPayload: { strategy: "nonexistent_strategy" } },
      evalCase,
    );
    expect(unknownStrategy.passed).toBe(false);
  });
});
