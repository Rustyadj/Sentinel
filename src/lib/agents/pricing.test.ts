import { describe, expect, it } from "vitest";
import { calculateModelCost, isReportedTokenUsage } from "./pricing";

const usage = {
  inputTokens: 1_000,
  outputTokens: 200,
  cachedInputTokens: 500,
  cacheWrite5mInputTokens: 100,
  cacheWrite1hInputTokens: 50,
};

describe("agent model pricing", () => {
  it("prices mutually exclusive reported token buckets", () => {
    expect(calculateModelCost("claude-opus-5", usage)).toBeCloseTo(0.011375, 8);
  });

  it("returns null, never zero, when usage is absent or the model is unlisted", () => {
    expect(calculateModelCost("claude-opus-5", undefined)).toBeNull();
    expect(calculateModelCost("future-unlisted-model", usage)).toBeNull();
  });

  it("rejects malformed or negative usage", () => {
    expect(isReportedTokenUsage({ ...usage, outputTokens: -1 })).toBe(false);
    expect(isReportedTokenUsage({ ...usage, inputTokens: Number.NaN })).toBe(false);
    expect(isReportedTokenUsage({ ...usage, cacheWrite1hInputTokens: undefined })).toBe(false);
  });
});
