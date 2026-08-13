import { describe, expect, it } from "vitest";
import { computeExpectedValue, evaluateQuestionQuality, foldUncertaintyIntoFactors, shouldAskWhyQuestion } from "@/lib/learning/curiosity-ev";

describe("Curiosity engine upgrade — expected value of clarification", () => {
  it("high risk + irreversible + important + little evidence favors asking", () => {
    const result = computeExpectedValue({
      riskOfWrongAssumption: 0.8,
      irreversibility: 0.9,
      userEffort: 0.2,
      confidence: 0.3,
      importance: 0.9,
      availableEvidence: 0.1,
      abilityToRecover: 0.1,
    });
    expect(result.shouldConsiderAsking).toBe(true);
    expect(result.expectedValueOfClarification).toBeGreaterThan(result.expectedCostOfInterruption);
  });

  it("low risk + reversible + high user effort favors NOT asking", () => {
    const result = computeExpectedValue({
      riskOfWrongAssumption: 0.1,
      irreversibility: 0.1,
      userEffort: 0.9,
      confidence: 0.9,
      importance: 0.2,
      availableEvidence: 0.9,
      abilityToRecover: 0.9,
    });
    expect(result.shouldConsiderAsking).toBe(false);
  });
});

describe("Curiosity engine upgrade — question quality", () => {
  it("a vague, redundant, low-information question is suppressed even if raised", () => {
    const result = evaluateQuestionQuality({
      necessity: 0.2,
      specificity: 0.1,
      informationGain: 0.1,
      userBurden: 0.7,
      redundancy: 0.8,
    });
    expect(result.shouldAsk).toBe(false);
    expect(result.reasons.length).toBeGreaterThan(0);
  });

  it("a necessary, specific, high-information-gain question clears the bar", () => {
    const result = evaluateQuestionQuality({
      necessity: 0.9,
      specificity: 0.9,
      informationGain: 0.9,
      userBurden: 0.1,
      redundancy: 0,
      timing: 0.9,
    });
    expect(result.shouldAsk).toBe(true);
  });
});

describe("Curiosity engine upgrade — uncertainty folding and why-questions", () => {
  it("folds the seven uncertainty dimensions into the existing coarse factors", () => {
    const factors = foldUncertaintyIntoFactors({ intentUncertainty: 0.8, contradictionUncertainty: 0.6 });
    expect(factors.ambiguityScore).toBeCloseTo(0.8, 5);
    expect(factors.conflictScore).toBeCloseTo(0.6, 5);
  });

  it("a 'why' question is only asked when the answer could materially affect something and confidence is low", () => {
    expect(shouldAskWhyQuestion({ materiallyAffects: ["procedure"], confidence: 0.4 })).toBe(true);
    expect(shouldAskWhyQuestion({ materiallyAffects: [], confidence: 0.2 })).toBe(false);
    expect(shouldAskWhyQuestion({ materiallyAffects: ["procedure"], confidence: 0.95 })).toBe(false);
  });
});
