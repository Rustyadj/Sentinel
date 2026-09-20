import { describe, expect, it } from "vitest";
import { normalizeToken, rankMemories, tokenize, type RankableMemory } from "./retrieval-ranking";

const base = {
  scope: "project",
  tags: [] as string[],
  pinned: false,
  confidence: 0.9,
  importanceScore: 0.5,
  valueScore: 0.5,
  createdAt: new Date("2026-09-01T00:00:00Z"),
};

const memory = (id: string, content: string, overrides: Partial<RankableMemory> = {}): RankableMemory => ({
  ...base,
  id,
  content,
  ...overrides,
});

const NOW = new Date("2026-09-20T00:00:00Z").getTime();

describe("tokenize", () => {
  it("drops stop words and keeps identifiers intact", () => {
    expect(tokenize("What does SNTL-4471 mean?")).toEqual(["sntl-4471", "mean"]);
  });

  it("normalises common inflections so 'prefers' matches 'prefer'", () => {
    expect(normalizeToken("prefers")).toBe("prefer");
    expect(normalizeToken("migrations")).toBe("migration");
    expect(normalizeToken("deployed")).toBe("deploy");
  });

  it("never mangles identifier-like tokens", () => {
    // Stemming "sntl-4471" or "text-embedding-3-small" would destroy the rare
    // term signal that makes exact retrieval work.
    expect(normalizeToken("sntl-4471")).toBe("sntl-4471");
    expect(normalizeToken("text-embedding-3-small")).toBe("text-embedding-3-small");
  });
});

describe("rankMemories", () => {
  it("returns candidates untouched when there is no query", () => {
    const candidates = [memory("a", "first"), memory("b", "second")];
    const ranked = rankMemories("", candidates, { limit: 10, now: NOW });
    expect(ranked.map((entry) => entry.memory.id)).toEqual(["a", "b"]);
    expect(ranked[0].factors[0].name).toBe("no_query");
  });

  it("ranks a memory that answers the question above a newer irrelevant one", () => {
    const candidates = [
      memory("noise", "Routine build 12 completed without notable findings.", {
        createdAt: new Date("2026-09-19T00:00:00Z"),
        valueScore: 0.9,
      }),
      memory("answer", "Sentinel's primary datastore is PostgreSQL 16 with pgvector.", {
        createdAt: new Date("2026-08-01T00:00:00Z"),
        valueScore: 0.2,
      }),
    ];
    const ranked = rankMemories("What database does Sentinel use?", candidates, { limit: 10, now: NOW });
    expect(ranked[0].memory.id).toBe("answer");
  });

  it("excludes memories that match no term of the question", () => {
    const candidates = [
      memory("match", "The retrieval cache TTL is 300 seconds."),
      memory("unrelated", "Lisa is the Hermes agent owned by Andrea."),
    ];
    const ranked = rankMemories("What is the cache TTL?", candidates, { limit: 10, now: NOW });
    expect(ranked.map((entry) => entry.memory.id)).toEqual(["match"]);
  });

  it("weights a rare identifier above a common word", () => {
    const candidates = [
      memory("common", "Sentinel runs on the Sentinel VPS with Sentinel workers."),
      memory("rare", "Error code SNTL-4471 means the orchestration worker lost Redis."),
      memory("other", "Sentinel deploys with docker compose."),
    ];
    const ranked = rankMemories("What does SNTL-4471 mean?", candidates, { limit: 10, now: NOW });
    expect(ranked[0].memory.id).toBe("rare");
  });

  it("honours the limit and the relative floor", () => {
    const candidates = [
      memory("strong", "PostgreSQL is the database used by Sentinel for everything."),
      memory("weak", "Sentinel was mentioned once in passing here."),
    ];
    const ranked = rankMemories("Which database does Sentinel use?", candidates, {
      limit: 1,
      now: NOW,
    });
    expect(ranked).toHaveLength(1);
    expect(ranked[0].memory.id).toBe("strong");
  });

  it("explains why each memory was selected", () => {
    const ranked = rankMemories("cache TTL", [memory("m", "The retrieval cache TTL is 300 seconds.")], {
      limit: 5,
      now: NOW,
    });
    const lexical = ranked[0].factors.find((factor) => factor.name === "lexical_coverage");
    expect(lexical?.detail).toContain("cache");
    expect(ranked[0].factors.map((factor) => factor.name)).toContain("rare_term");
  });
});
