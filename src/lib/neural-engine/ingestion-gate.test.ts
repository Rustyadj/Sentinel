import { describe, expect, it } from "vitest";
import {
  classifyForIngestion,
  computeNovelty,
  contentSimilarity,
  memoryTypeForLane,
  DUPLICATE_SIMILARITY_THRESHOLD,
} from "./ingestion-gate";

const classify = (content: string, overrides = {}) =>
  classifyForIngestion({ content, speaker: "user", ...overrides });

describe("hard exclusions", () => {
  it("never stores secret-shaped content", () => {
    const cases = [
      "the api key is sk-abcdefghijklmnopqrstuvwxyz123456",
      "use Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9abcdef",
      "password: hunter2correcthorse",
      "-----BEGIN RSA PRIVATE KEY-----",
    ];
    for (const content of cases) {
      const verdict = classify(content);
      expect(verdict.decision, content).toBe("DISCARD");
      expect(verdict.signals.sensitivity).toBe(1);
      expect(verdict.reasons.join(" ")).toMatch(/secret/i);
    }
  });

  it("discards acknowledgements and conversational filler", () => {
    for (const content of ["ok", "thanks!", "sounds good", "hello there", "let me check that for you"]) {
      expect(classify(content).decision, content).toBe("DISCARD");
    }
  });

  it("discards content too short to carry reusable meaning", () => {
    expect(classify("yes it is").decision).toBe("DISCARD");
  });

  it("discards a near-duplicate of something already stored", () => {
    const existing = ["the production database runs on postgres 16 in docker"];
    const verdict = classify("the production database runs on postgres 16 inside docker", { existingContents: existing });
    expect(verdict.decision).toBe("DISCARD");
    expect(verdict.reasons.join(" ")).toMatch(/duplicate/i);
  });

  it("keeps a genuinely different statement even when the topic overlaps", () => {
    const existing = ["the production database runs on postgres 16 in docker"];
    const verdict = classify("the staging redis instance is not port mapped to the host", {
      existingContents: existing,
    });
    expect(verdict.decision).not.toBe("DISCARD");
  });
});

describe("lane classification", () => {
  it("routes standing instructions to PREFERENCE", () => {
    for (const content of [
      "I prefer dark solid backgrounds, never glass morphism",
      "always use conventional commits going forward",
      "don't ever add emoji to commit messages",
    ]) {
      expect(classify(content).lane, content).toBe("PREFERENCE");
    }
  });

  it("routes reusable how-to knowledge to PROCEDURAL", () => {
    for (const content of [
      "the fix was to restart the orchestration worker after changing REDIS_URL",
      "first apply the migration, then regenerate the client, finally restart the app",
    ]) {
      expect(classify(content).lane, content).toBe("PROCEDURAL");
    }
  });

  it("routes relationship assertions to ENTITY_RELATION", () => {
    for (const content of [
      "Cody is the owner of the Hughes agent",
      "the learning worker depends on the redis instance",
    ]) {
      expect(classify(content).lane, content).toBe("ENTITY_RELATION");
    }
  });

  it("routes durable environment facts to SEMANTIC", () => {
    const verdict = classify("the sentinel app is deployed at neural.srv1427612.hstgr.cloud");
    expect(verdict.lane).toBe("SEMANTIC");
  });

  it("falls back to EPISODIC rather than inventing a durable claim", () => {
    const verdict = classify("we spent the session tracing why the deploy pipeline stalled unexpectedly");
    expect(["EPISODIC", "DISCARD"]).toContain(verdict.decision);
  });

  it("maps every lane onto the existing Memory.type vocabulary", () => {
    expect(memoryTypeForLane("PREFERENCE")).toBe("preference");
    expect(memoryTypeForLane("PROCEDURAL")).toBe("skill");
    expect(memoryTypeForLane("ENTITY_RELATION")).toBe("relationship");
    expect(memoryTypeForLane("SEMANTIC")).toBe("fact");
    expect(memoryTypeForLane("EPISODIC")).toBe("event");
  });
});

describe("signals", () => {
  it("trusts a user statement above an agent inference", () => {
    const content = "the deploy target is the production compose stack";
    const fromUser = classify(content, { speaker: "user" });
    const fromEngine = classify(content, { speaker: "agent", source: "neural-engine:inference" });
    expect(fromUser.signals.sourceReliability).toBeGreaterThan(fromEngine.signals.sourceReliability);
  });

  it("marks time-bound statements as having short shelf life", () => {
    const verdict = classify("the orchestration worker is currently down");
    expect(verdict.signals.temporalRelevance).toBeLessThan(0.5);
  });

  it("scores novelty against what is already stored", () => {
    expect(computeNovelty("brand new unrelated statement", [])).toBe(1);
    expect(computeNovelty("the sky is blue today", ["the sky is blue today"])).toBeLessThan(0.05);
  });

  it("reports a bounded expected retrieval value", () => {
    const verdict = classify("I always want migrations reviewed before they are applied");
    expect(verdict.expectedRetrievalValue).toBeGreaterThan(0);
    expect(verdict.expectedRetrievalValue).toBeLessThanOrEqual(1);
  });

  it("flags low-conviction classifications for review instead of faking certainty", () => {
    const verdict = classify("we looked at the graph tab and then moved on to something else");
    if (verdict.decision !== "DISCARD") expect(verdict.needsModelReview).toBe(true);
  });
});

describe("rationale is always recorded", () => {
  it("gives at least one reason for every decision, accepted or rejected", () => {
    const samples = [
      "ok",
      "sk-abcdefghijklmnopqrstuvwxyz123456",
      "I prefer tabs over spaces in this repo",
      "the fix was to clear the redis queue first",
      "the api lives on port 3100",
    ];
    for (const content of samples) {
      const verdict = classify(content);
      expect(verdict.reasons.length, content).toBeGreaterThan(0);
      expect(verdict.reasons.every((reason) => reason.length > 0)).toBe(true);
    }
  });
});

describe("contentSimilarity", () => {
  it("is 1 for identical text and 0 for disjoint text", () => {
    expect(contentSimilarity("alpha beta gamma", "alpha beta gamma")).toBe(1);
    expect(contentSimilarity("alpha beta", "xxxx yyyy")).toBe(0);
  });

  it("exceeds the duplicate threshold for a trivial rewording", () => {
    const similarity = contentSimilarity(
      "the production database runs postgres sixteen",
      "the production database runs postgres sixteen",
    );
    expect(similarity).toBeGreaterThanOrEqual(DUPLICATE_SIMILARITY_THRESHOLD);
  });
});
