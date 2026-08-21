import { describe, expect, it } from "vitest";
import { AGENT_CAPABILITY_KEYS, defaultCapabilityWeights, sanitizeCapabilityWeights } from "./capability-defaults";

describe("defaultCapabilityWeights", () => {
  it("returns the built-in table for a known agent id", () => {
    expect(defaultCapabilityWeights("codex").testing).toBeGreaterThan(0.9);
  });

  it("returns an empty object for an unregistered agent id", () => {
    expect(defaultCapabilityWeights("some-unknown-agent")).toEqual({});
  });
});

describe("sanitizeCapabilityWeights", () => {
  it("keeps only known capability keys with in-range numeric values", () => {
    const result = sanitizeCapabilityWeights({ coding: 0.7, notARealCapability: 0.9, backend: "0.5" });
    expect(result).toEqual({ coding: 0.7 });
  });

  it("clamps values outside [0, 1]", () => {
    const result = sanitizeCapabilityWeights({ coding: 5, testing: -3 });
    expect(result).toEqual({ coding: 1, testing: 0 });
  });

  it("drops non-finite values", () => {
    const result = sanitizeCapabilityWeights({ coding: Number.NaN, testing: Number.POSITIVE_INFINITY, backend: 0.4 });
    expect(result).toEqual({ backend: 0.4 });
  });

  it("returns an empty object for non-object input", () => {
    expect(sanitizeCapabilityWeights(null)).toEqual({});
    expect(sanitizeCapabilityWeights(undefined)).toEqual({});
    expect(sanitizeCapabilityWeights("not an object")).toEqual({});
    expect(sanitizeCapabilityWeights([1, 2, 3])).toEqual({});
  });

  it("never produces a key outside AGENT_CAPABILITY_KEYS", () => {
    const input = Object.fromEntries(AGENT_CAPABILITY_KEYS.map((k) => [k, 0.5]));
    const result = sanitizeCapabilityWeights({ ...input, madeUpKey: 0.9 });
    expect(Object.keys(result).sort()).toEqual([...AGENT_CAPABILITY_KEYS].sort());
  });
});
