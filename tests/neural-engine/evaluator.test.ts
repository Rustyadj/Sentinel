import { describe, expect, it } from "vitest";
import { scoreExperience } from "@/lib/neural-engine/evaluator";

describe("evaluator — scoreExperience (pure, deterministic)", () => {
  it("maps outcome status to successScore", () => {
    expect(scoreExperience({ outcomeStatus: "success", latencyMs: 1000, hasErrors: false }).successScore).toBe(1);
    expect(scoreExperience({ outcomeStatus: "partial", latencyMs: 1000, hasErrors: false }).successScore).toBe(0.6);
    expect(scoreExperience({ outcomeStatus: "failure", latencyMs: 1000, hasErrors: false }).successScore).toBe(0);
    expect(scoreExperience({ outcomeStatus: "cancelled", latencyMs: 1000, hasErrors: false }).successScore).toBeNull();
  });

  it("gives full efficiency under the fast band and floors past the slow band", () => {
    expect(scoreExperience({ outcomeStatus: "success", latencyMs: 500, hasErrors: false }).efficiencyScore).toBe(1);
    expect(scoreExperience({ outcomeStatus: "success", latencyMs: 60_000, hasErrors: false }).efficiencyScore).toBeCloseTo(0.3, 5);
  });

  it("decays efficiency monotonically between the fast and slow bands", () => {
    const mid = scoreExperience({ outcomeStatus: "success", latencyMs: 16_500, hasErrors: false }).efficiencyScore;
    expect(mid).toBeGreaterThan(0.3);
    expect(mid).toBeLessThan(1);
  });

  it("reduces safety when errors are present, but never to zero", () => {
    expect(scoreExperience({ outcomeStatus: "failure", latencyMs: 1000, hasErrors: true }).safetyScore).toBe(0.7);
    expect(scoreExperience({ outcomeStatus: "success", latencyMs: 1000, hasErrors: false }).safetyScore).toBe(1);
  });

  it("treats unknown latency as neutral efficiency and lowers confidence", () => {
    const known = scoreExperience({ outcomeStatus: "success", latencyMs: 1000, hasErrors: false });
    const unknown = scoreExperience({ outcomeStatus: "success", latencyMs: null, hasErrors: false });
    expect(unknown.efficiencyScore).toBe(0.6);
    expect(unknown.confidence).toBeLessThan(known.confidence);
  });

  it("never reports a confidence high enough for a single observation to auto-apply", () => {
    // Max confidence from scoring alone is 0.9, but the evaluator additionally
    // gates auto-apply on evidenceCount >= 3 (tested in the integration suite).
    const best = scoreExperience({ outcomeStatus: "success", latencyMs: 100, hasErrors: false });
    expect(best.confidence).toBeLessThanOrEqual(0.9);
  });
});
