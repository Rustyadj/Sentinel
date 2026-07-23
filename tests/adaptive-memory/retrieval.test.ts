import { describe, expect, it, vi } from "vitest";
vi.mock("@/lib/current-user", () => ({ requireUser: vi.fn() }));
import { hybridScore, keywordScore } from "@/lib/adaptive-memory/retrieval";

const factors = { semantic: 0.8, keyword: 0.8, graph: 0.5, scope: 1, recency: 1,
  importance: 0.8, confidence: 0.9, sourceTrust: 0.9, historical: 0.7,
  preference: 0.6, contradictionPenalty: 0, stalenessPenalty: 0 };
describe("hybrid retrieval", () => {
  it("scores keyword overlap", () => expect(keywordScore("production rollback", "production deployment rollback plan")).toBe(1));
  it("penalizes contradictions", () => expect(hybridScore({ ...factors, contradictionPenalty: 1 })).toBeLessThan(hybridScore(factors)));
  it("penalizes stale memory", () => expect(hybridScore({ ...factors, stalenessPenalty: 1 })).toBeLessThan(hybridScore(factors)));
  it("rewards semantic evidence", () => expect(hybridScore({ ...factors, semantic: 1 })).toBeGreaterThan(hybridScore({ ...factors, semantic: 0 })));
});
