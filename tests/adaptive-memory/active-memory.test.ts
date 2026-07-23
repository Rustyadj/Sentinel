import { describe, expect, it } from "vitest";
import { boundActiveMemoryCard, estimateTokens } from "@/lib/adaptive-memory/active-memory";
import type { ActiveMemoryCard } from "@/lib/adaptive-memory/types";

const card: ActiveMemoryCard = {
  actingUser: { id: "u1", preferences: Array.from({ length: 30 }, (_, i) => `preference ${i} ${"x".repeat(30)}`) },
  agent: { id: "a1", role: "operator", toolRestrictions: ["no production deploy"] },
  objective: "Safely inspect a large context", activeDecisions: Array.from({ length: 20 }, (_, i) => ({ id: `d${i}`, title: `Decision ${i}`, summary: "z".repeat(100) })),
  constraints: Array.from({ length: 20 }, (_, i) => `constraint ${i}`),
  criticalPolicies: Array.from({ length: 20 }, (_, i) => ({ id: `p${i}`, name: `Policy ${i}`, description: "y".repeat(100) })),
  approvalRequirements: ["human approval"],
};
describe("active memory card", () => {
  it("is bounded without mutating its input", () => {
    const before = JSON.stringify(card); const result = boundActiveMemoryCard(card, 600);
    expect(result.tokens).toBeLessThanOrEqual(600); expect(estimateTokens(result.text)).toBe(result.tokens);
    expect(JSON.stringify(card)).toBe(before);
  });
});
