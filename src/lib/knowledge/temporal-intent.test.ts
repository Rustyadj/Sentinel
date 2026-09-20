import { describe, expect, it } from "vitest";
import { classifyTemporalIntent, includesSupersededMemories } from "./temporal-intent";
import { CASES } from "../../../bench/memory/dataset";

describe("classifyTemporalIntent", () => {
  it("treats an ordinary question as being about now", () => {
    for (const query of [
      "What is Sentinel's default chat model?",
      "Which port does the Sentinel container listen on?",
      "Give me the current deployment configuration.",
      "What happened during the MCP rollout?",
      "Walk me through the MCP rollout in order.",
      "What database does Sentinel use?",
    ]) {
      expect(classifyTemporalIntent(query).intent, query).toBe("current");
    }
  });

  it("recognises an explicit look-back", () => {
    for (const query of [
      "What provider were we using before the switch?",
      "Which model did we use previously?",
      "What database did we used to run on?",
      "What did we believe about the cache TTL?",
      "What was the previous value of the deployment port?",
    ]) {
      expect(classifyTemporalIntent(query).intent, query).toBe("historical");
    }
  });

  it("recognises a point-in-time question and parses the point", () => {
    const result = classifyTemporalIntent("What was the default model as of 2026-03-01?");
    expect(result.intent).toBe("as_of");
    expect(result.asOf?.toISOString()).toBe("2026-03-01T00:00:00.000Z");
  });

  it("prefers a look-back over a date mentioned only to locate the change", () => {
    const result = classifyTemporalIntent("What were we using before the 2026 migration?");
    expect(result.intent).toBe("historical");
  });

  it("only current-truth queries exclude superseded beliefs", () => {
    expect(includesSupersededMemories("current")).toBe(false);
    expect(includesSupersededMemories("historical")).toBe(true);
    expect(includesSupersededMemories("as_of")).toBe(true);
  });

  it("classifies no benchmark case as historical", () => {
    // The benchmark's 32 cases are all current-truth questions. If a change to
    // the cues starts reading one of them as a look-back, superseded memories
    // re-enter that case's candidate set and false retrieval rises — which is
    // the regression Phase 8 exists to remove. This pins that.
    const misread = CASES
      .filter((testCase) => classifyTemporalIntent(testCase.query).intent !== "current")
      .map((testCase) => `${testCase.id}: ${testCase.query}`);
    expect(misread).toEqual([]);
  });
});
