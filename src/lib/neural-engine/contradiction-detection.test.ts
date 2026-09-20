import { describe, expect, it } from "vitest";
import {
  assessContradiction,
  displacedValues,
  hasCorrectionMarker,
  subjectOverlap,
  type ComparableMemory,
} from "./contradiction-detection";

const DAY = 86_400_000;
const now = Date.UTC(2026, 8, 20);

function mem(overrides: Partial<ComparableMemory> & { id: string; content: string }): ComparableMemory {
  const createdAt = overrides.createdAt ?? new Date(now);
  return {
    tags: [],
    scope: "project",
    projectId: "proj-a",
    owner: "user-a",
    confidence: 0.9,
    createdAt,
    validFrom: createdAt,
    validTo: null,
    provenanceClass: "OBSERVED",
    source: "user",
    ...overrides,
  };
}

describe("signals", () => {
  it("recognises correction markers in content and tags", () => {
    expect(hasCorrectionMarker({ content: "Correction: the port is 3000.", tags: [] })).toBe(true);
    expect(hasCorrectionMarker({ content: "The port is 3000.", tags: ["correction"] })).toBe(true);
    expect(hasCorrectionMarker({ content: "The port is 3000.", tags: ["deploy"] })).toBe(false);
  });

  it("extracts the value a statement displaces", () => {
    expect(displacedValues("We use provider-b, not provider-a.")).toContain("provider-a");
    expect(displacedValues("We switched to Postgres instead of MySQL.")).toContain("mysql");
    expect(displacedValues("The database is Postgres.")).toEqual([]);
  });

  it("scores subject overlap against the shorter memory, not the union", () => {
    expect(subjectOverlap("the retrieval cache ttl is 60 seconds", "the retrieval cache ttl is 300 seconds"))
      .toBeGreaterThan(0.7);
    expect(subjectOverlap("the deployment port is 8080", "alice prefers concise explanations")).toBeLessThan(0.2);
  });
});

describe("assessContradiction — supersession", () => {
  it("supersedes a belief that an explicit correction retires by name", () => {
    const existing = mem({
      id: "old",
      content: "Sentinel's default chat model is claude-3-opus.",
      createdAt: new Date(now - 120 * DAY),
      confidence: 0.9,
    });
    const incoming = mem({
      id: "new",
      content: "Correction: Sentinel's default chat model is claude-sonnet-4-6, not claude-3-opus.",
      tags: ["model", "correction"],
      createdAt: new Date(now - 3 * DAY),
      confidence: 0.98,
    });

    const result = assessContradiction(incoming, existing);
    expect(result.action).toBe("SUPERSEDE");
    expect(result.evidence.map((e) => e.code)).toContain("displaces_existing_value");
    expect(result.opensContradiction).toBe(false);
  });

  it("is the correction, not recency, that decides — an older correction does not supersede", () => {
    const existing = mem({ id: "old", content: "The provider is provider-b.", createdAt: new Date(now) });
    const incoming = mem({
      id: "new",
      content: "Correction: the provider is provider-a, not provider-b.",
      tags: ["correction"],
      createdAt: new Date(now - 10 * DAY),
    });
    expect(assessContradiction(incoming, existing).action).not.toBe("SUPERSEDE");
  });
});

describe("assessContradiction — refusing to over-detect", () => {
  it("does not treat two claims about different periods as a contradiction", () => {
    const existing = mem({ id: "old", content: "The truck was red in 2025.", createdAt: new Date(now - 300 * DAY) });
    const incoming = mem({ id: "new", content: "The truck is blue now.", createdAt: new Date(now) });

    const result = assessContradiction(incoming, existing);
    expect(result.action).toBe("NO_CHANGE");
    expect(result.evidence.map((e) => e.code)).toContain("existing_period_bound");
  });

  it("never lets one scope supersede another", () => {
    const existing = mem({ id: "global", content: "Timestamps are stored in UTC.", scope: "global", projectId: null });
    const incoming = mem({
      id: "proj",
      content: "Correction: timestamps are stored in local time, not UTC.",
      tags: ["correction"],
      scope: "project",
      projectId: "proj-a",
    });

    const result = assessContradiction(incoming, existing);
    expect(result.action).toBe("NO_CHANGE");
    expect(result.evidence.map((e) => e.code)).toContain("scope_incompatible");
  });

  it("never lets one owner's memory supersede another's", () => {
    const existing = mem({ id: "a", content: "The API key rotates every 30 days.", owner: "user-a" });
    const incoming = mem({
      id: "b",
      content: "Correction: the API key rotates every 90 days, not 30.",
      tags: ["correction"],
      owner: "user-b",
    });
    expect(assessContradiction(incoming, existing).action).toBe("NO_CHANGE");
  });

  it("opens a contradiction, rather than picking a winner, when nothing resolves the conflict", () => {
    const existing = mem({ id: "a", content: "The retrieval cache TTL is 60 seconds.", createdAt: new Date(now - 12 * DAY) });
    const incoming = mem({ id: "b", content: "The retrieval cache TTL is 300 seconds.", createdAt: new Date(now - 10 * DAY) });

    const result = assessContradiction(incoming, existing);
    expect(result.action).toBe("NO_CHANGE");
    expect(result.opensContradiction).toBe(true);
    expect(result.evidence.map((e) => e.code)).toContain("unresolved_conflict");
  });

  it("reinforces rather than supersedes when the same fact is stated twice", () => {
    const existing = mem({ id: "a", content: "Sentinel deploys via docker compose on the Hostinger VPS." });
    const incoming = mem({ id: "b", content: "Sentinel is deployed using docker compose on the Hostinger VPS." });
    expect(assessContradiction(incoming, existing).action).toBe("REINFORCE");
  });

  it("leaves unrelated memories alone", () => {
    const existing = mem({ id: "a", content: "Alice prefers concise explanations without preamble." });
    const incoming = mem({ id: "b", content: "The orchestration worker retries failed jobs three times." });
    const result = assessContradiction(incoming, existing);
    expect(result.action).toBe("NO_CHANGE");
    expect(result.opensContradiction).toBe(false);
  });

  it("will not reopen a memory that was already closed", () => {
    const existing = mem({
      id: "a",
      content: "The container listens on port 8080.",
      createdAt: new Date(now - 90 * DAY),
      validTo: new Date(now - 35 * DAY),
    });
    const incoming = mem({
      id: "b",
      content: "Correction: the container listens on port 3000, not 8080.",
      tags: ["correction"],
      createdAt: new Date(now),
    });
    const result = assessContradiction(incoming, existing);
    expect(result.action).toBe("NO_CHANGE");
    expect(result.evidence.map((e) => e.code)).toContain("no_valid_time_overlap");
  });
});
