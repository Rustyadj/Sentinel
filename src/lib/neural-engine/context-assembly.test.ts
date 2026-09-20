import { describe, expect, it } from "vitest";
import {
  assembleContext,
  withMemoryContext,
  estimateTokens,
  DEFAULT_CONTEXT_TOKEN_BUDGET,
} from "./context-assembly";

const memory = (id: string, content: string, scope = "project") => ({ id, content, scope });

describe("assembleContext", () => {
  it("returns an empty block when there is nothing to inject", () => {
    const result = assembleContext({ memories: [] });
    expect(result.text).toBe("");
    expect(result.injected).toEqual([]);
    expect(result.estimatedTokens).toBe(0);
  });

  it("records rank and token cost for every injected memory", () => {
    const result = assembleContext({
      memories: [memory("m1", "deploys run from the main branch"), memory("m2", "postgres lives in docker")],
    });

    expect(result.injected.map((item) => item.memoryId)).toEqual(["m1", "m2"]);
    expect(result.injected.map((item) => item.rank)).toEqual([0, 1]);
    expect(result.injected.every((item) => item.estimatedTokens > 0)).toBe(true);
    expect(result.droppedMemoryIds).toEqual([]);
  });

  it("preserves caller ordering rather than re-ranking", () => {
    const result = assembleContext({
      memories: [memory("low", "aaa"), memory("high", "zzz")],
    });
    expect(result.injected.map((item) => item.memoryId)).toEqual(["low", "high"]);
  });

  it("drops memories that do not fit the budget and reports them", () => {
    const big = "x".repeat(2000);
    const result = assembleContext(
      { memories: [memory("fits", "short one"), memory("huge", big), memory("also-fits", "another short one")] },
      { tokenBudget: 60 },
    );

    expect(result.injected.map((item) => item.memoryId)).toContain("fits");
    expect(result.droppedMemoryIds).toContain("huge");
    expect(result.estimatedTokens).toBeLessThanOrEqual(60);
  });

  it("never exceeds the token budget", () => {
    const memories = Array.from({ length: 200 }, (_, i) => memory(`m${i}`, `memory number ${i} `.repeat(20)));
    const result = assembleContext({ memories }, { tokenBudget: 300 });
    expect(result.estimatedTokens).toBeLessThanOrEqual(300);
    expect(result.droppedMemoryIds.length).toBeGreaterThan(0);
  });

  it("drops everything when the budget is zero", () => {
    const result = assembleContext({ memories: [memory("m1", "anything")] }, { tokenBudget: 0 });
    expect(result.text).toBe("");
    expect(result.injected).toEqual([]);
    expect(result.droppedMemoryIds).toEqual(["m1"]);
  });

  it("truncates an individual memory rather than letting it consume the budget", () => {
    const result = assembleContext({ memories: [memory("m1", "y".repeat(5000))] }, { maxItemChars: 100 });
    expect(result.text).toContain("…");
    expect(result.text.length).toBeLessThan(500);
  });

  it("labels memories with their scope so provenance survives into the prompt", () => {
    const result = assembleContext({ memories: [memory("m1", "a user fact", "user")] });
    expect(result.text).toContain("(user)");
  });

  it("includes decisions and notes in their own sections", () => {
    const result = assembleContext({
      memories: [],
      decisions: [{ id: "d1", title: "Use Postgres", summary: "chosen for pgvector", status: "approved" }],
      notes: [{ id: "n1", title: "Runbook", content: "restart with compose" }],
    });
    expect(result.text).toContain("Prior decisions");
    expect(result.text).toContain("Use Postgres");
    expect(result.text).toContain("Project notes");
  });

  it("defaults to the documented budget", () => {
    const memories = Array.from({ length: 500 }, (_, i) => memory(`m${i}`, `fact ${i} `.repeat(30)));
    const result = assembleContext({ memories });
    expect(result.estimatedTokens).toBeLessThanOrEqual(DEFAULT_CONTEXT_TOKEN_BUDGET);
  });
});

describe("withMemoryContext", () => {
  it("leaves the prompt byte-identical when no memory was assembled", () => {
    const empty = assembleContext({ memories: [] });
    expect(withMemoryContext("do the thing", empty)).toBe("do the thing");
  });

  it("prepends the block above the task, separated by a rule", () => {
    const context = assembleContext({ memories: [memory("m1", "the deploy target is prod")] });
    const prompt = withMemoryContext("do the thing", context);
    expect(prompt.startsWith("## Sentinel memory")).toBe(true);
    expect(prompt).toContain("---");
    expect(prompt.endsWith("do the thing")).toBe(true);
  });
});

describe("estimateTokens", () => {
  it("scales with length and is never negative", () => {
    expect(estimateTokens("")).toBe(0);
    expect(estimateTokens("abcd")).toBe(1);
    expect(estimateTokens("a".repeat(400))).toBe(100);
  });
});
