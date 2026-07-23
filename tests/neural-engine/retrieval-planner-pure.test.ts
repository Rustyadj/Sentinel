import { describe, expect, it } from "vitest";
import {
  lexicalOverlapScore,
  scoreCandidateFactors,
  FACTOR_WEIGHTS,
  type RetrievalRequest,
} from "@/lib/neural-engine/retrieval-planner";

const baseRequest: RetrievalRequest = { userId: "retrieval-planner-pure", query: "deploy pipeline", maxItems: 20 };

function signals(overrides: Partial<Parameters<typeof scoreCandidateFactors>[0]> = {}) {
  return {
    id: "obj-1",
    type: "Note",
    scope: "project",
    title: "Deploy pipeline runbook",
    summary: "How to run the deploy pipeline",
    updatedAt: new Date(),
    confidence: null,
    importance: null,
    provenanceQuality: 0.5,
    ...overrides,
  };
}

const neutralExtras = {
  isExplicit: false,
  graphHops: null,
  successWeight: 0,
  failureWeight: 0,
  competencyScore: null,
};

describe("retrieval-planner — lexicalOverlapScore (documented lexical proxy, not embeddings)", () => {
  it("scores 0 for completely disjoint text", () => {
    expect(lexicalOverlapScore("deploy pipeline", "unrelated cooking recipe")).toBe(0);
  });

  it("scores higher for more shared tokens", () => {
    const low = lexicalOverlapScore("deploy pipeline", "the deploy process");
    const high = lexicalOverlapScore("deploy pipeline", "deploy pipeline runbook and process");
    expect(high).toBeGreaterThan(low);
  });

  it("returns 0 for empty query or empty candidate text", () => {
    expect(lexicalOverlapScore("", "deploy pipeline")).toBe(0);
    expect(lexicalOverlapScore("deploy pipeline", "")).toBe(0);
  });
});

describe("retrieval-planner — scoreCandidateFactors (pure, no DB)", () => {
  it("gives explicit_selection a full score only when the object was explicitly requested", () => {
    const explicit = scoreCandidateFactors(signals(), baseRequest, {
      ...neutralExtras,
      isExplicit: true,
    });
    const implicit = scoreCandidateFactors(signals(), baseRequest, neutralExtras);

    const explicitFactor = explicit.find((f) => f.factor === "explicit_selection")!;
    const implicitFactor = implicit.find((f) => f.factor === "explicit_selection")!;
    expect(explicitFactor.score).toBe(1);
    expect(implicitFactor.score).toBe(0);
  });

  it("prior_failure is encoded with a negative weight so it penalizes, not rewards", () => {
    const factors = scoreCandidateFactors(signals(), baseRequest, neutralExtras);
    const failureFactor = factors.find((f) => f.factor === "prior_failure")!;
    expect(failureFactor.weight).toBeLessThan(0);
    expect(failureFactor.weight).toBe(-FACTOR_WEIGHTS.prior_failure);
  });

  it("graph_proximity score decreases with more hops, and is 0 when unreachable", () => {
    const close = scoreCandidateFactors(signals(), baseRequest, { ...neutralExtras, graphHops: 1 });
    const far = scoreCandidateFactors(signals(), baseRequest, { ...neutralExtras, graphHops: 3 });
    const unreachable = scoreCandidateFactors(signals(), baseRequest, {
      ...neutralExtras,
      graphHops: null,
    });

    const closeScore = close.find((f) => f.factor === "graph_proximity")!.score;
    const farScore = far.find((f) => f.factor === "graph_proximity")!.score;
    const unreachableScore = unreachable.find((f) => f.factor === "graph_proximity")!.score;

    expect(closeScore).toBeGreaterThan(farScore);
    expect(unreachableScore).toBe(0);
  });

  it("defaults confidence/importance/agent_competency to neutral (0.5) when signal is absent", () => {
    const factors = scoreCandidateFactors(signals(), baseRequest, neutralExtras);
    expect(factors.find((f) => f.factor === "confidence")!.score).toBe(0.5);
    expect(factors.find((f) => f.factor === "importance")!.score).toBe(0.5);
    expect(factors.find((f) => f.factor === "agent_competency")!.score).toBe(0.5);
  });

  it("uses real confidence/importance signal when present instead of the neutral default", () => {
    const factors = scoreCandidateFactors(
      signals({ confidence: 0.95, importance: 0.9 }),
      baseRequest,
      neutralExtras,
    );
    expect(factors.find((f) => f.factor === "confidence")!.score).toBe(0.95);
    expect(factors.find((f) => f.factor === "importance")!.score).toBe(0.9);
  });

  it("boosts task_type score when the object's type matches the affinity list", () => {
    const matched = scoreCandidateFactors(
      signals({ type: "Decision" }),
      { ...baseRequest, taskType: "planning" },
      neutralExtras,
    );
    const unmatched = scoreCandidateFactors(
      signals({ type: "Note" }),
      { ...baseRequest, taskType: "planning" },
      neutralExtras,
    );
    expect(matched.find((f) => f.factor === "task_type")!.score).toBeGreaterThan(
      unmatched.find((f) => f.factor === "task_type")!.score,
    );
  });

  it("gives narrower scope a higher scope score than broader scope", () => {
    const session = scoreCandidateFactors(signals({ scope: "session" }), baseRequest, neutralExtras);
    const global = scoreCandidateFactors(signals({ scope: "global" }), baseRequest, neutralExtras);
    expect(session.find((f) => f.factor === "scope")!.score).toBeGreaterThan(
      global.find((f) => f.factor === "scope")!.score,
    );
  });

  it("gives recently updated objects a higher recency score than stale ones", () => {
    const fresh = scoreCandidateFactors(
      signals({ updatedAt: new Date() }),
      baseRequest,
      neutralExtras,
    );
    const stale = scoreCandidateFactors(
      signals({ updatedAt: new Date(Date.now() - 60 * 24 * 60 * 60 * 1000) }),
      baseRequest,
      neutralExtras,
    );
    expect(fresh.find((f) => f.factor === "recency")!.score).toBeGreaterThan(
      stale.find((f) => f.factor === "recency")!.score,
    );
  });
});
