import { describe, expect, it } from "vitest";
import { DEFAULT_AUTONOMY_SETTINGS, resolveAutonomySettings, sanitizeAutonomySettings } from "./settings";
import { scoreOpportunity, selectProactiveWork, type Opportunity } from "./proactive";

describe("autonomy settings", () => {
  it("defaults to productive autonomy", () => {
    expect(DEFAULT_AUTONOMY_SETTINGS.proactiveExecution).toBe(true);
    expect(DEFAULT_AUTONOMY_SETTINGS.standingDelegation).toBe(true);
    expect(DEFAULT_AUTONOMY_SETTINGS.maxOrchestrationIterations).toBeGreaterThan(25);
  });

  it("drops unknown keys and wrong types, and clamps numbers to infrastructure bounds", () => {
    expect(sanitizeAutonomySettings({ proactiveExecution: "yes", allowEverything: true, maxConcurrentTasks: 999, proactiveMinScore: 2 }))
      .toEqual({ maxConcurrentTasks: 32, proactiveMinScore: 1 });
    expect(sanitizeAutonomySettings(null)).toEqual({});
  });

  it("there is no global override key that could bypass authority or tenancy", () => {
    expect(Object.keys(DEFAULT_AUTONOMY_SETTINGS).some((k) => /bypass|override|unrestricted|all/i.test(k))).toBe(false);
  });

  it("agent overrides workspace overrides defaults, key by key", () => {
    const effective = resolveAutonomySettings({ maxConcurrentTasks: 2, proactiveExecution: false }, { maxConcurrentTasks: 6 });
    expect(effective.maxConcurrentTasks).toBe(6);
    expect(effective.proactiveExecution).toBe(false);
    expect(effective.skillDevelopment).toBe(true);
  });
});

const op = (overrides: Partial<Opportunity> = {}): Opportunity => ({
  fingerprint: "f1", kind: "unfinished_task", workspaceId: "ws", agentId: "hermes-lisa", title: "t", detail: "d",
  target: { type: "room", roomId: "r" }, expectedValue: 0.9, strategicRelevance: 0.9, urgency: 0.9, executionCost: 0.1,
  resourceAvailability: 0.9, confidence: 0.9, dependenciesReady: true, authorized: true, ...overrides,
});
const settings = { proactiveExecution: true, proactiveIntervalMinutes: 30, proactiveDailyLimit: 5, proactiveMinScore: 0.5, maxConcurrentTasks: 2 };
const fresh = { recentFingerprints: new Set<string>(), lastActivationAt: null, startsLast24h: 0 };

describe("proactive prioritization", () => {
  it("scores by value, relevance, urgency, confidence and availability, discounted by cost", () => {
    expect(scoreOpportunity(op())).toBeGreaterThan(scoreOpportunity(op({ executionCost: 0.9 })));
    expect(scoreOpportunity(op({ dependenciesReady: false }))).toBe(0);
  });

  it("executes valuable authorized work, highest score first, up to concurrency", () => {
    const picked = selectProactiveWork([op({ fingerprint: "low", urgency: 0.6 }), op({ fingerprint: "high" }), op({ fingerprint: "mid", urgency: 0.7 })], settings, fresh);
    expect(picked.execute.map((o) => o.fingerprint)).toEqual(["high", "mid"]);
  });

  it("never executes work without authority; surfaces it instead", () => {
    const picked = selectProactiveWork([op({ authorized: false })], settings, fresh);
    expect(picked.execute).toEqual([]);
    expect(picked.needsAuthority).toHaveLength(1);
  });

  it("avoids spam: dedupes, honours the interval and daily limit, and the min score", () => {
    expect(selectProactiveWork([op(), op()], settings, fresh).execute).toHaveLength(1);
    expect(selectProactiveWork([op()], settings, { ...fresh, recentFingerprints: new Set(["f1"]) }).execute).toEqual([]);
    const now = new Date("2026-11-27T12:00:00Z");
    expect(selectProactiveWork([op()], settings, { ...fresh, lastActivationAt: new Date(now.getTime() - 10 * 60_000) }, now).execute).toEqual([]);
    expect(selectProactiveWork([op()], settings, { ...fresh, startsLast24h: 5 }).execute).toEqual([]);
    expect(selectProactiveWork([op({ expectedValue: 0, strategicRelevance: 0, urgency: 0, confidence: 0.1, resourceAvailability: 0.1 })], settings, fresh).execute).toEqual([]);
    expect(selectProactiveWork([op()], { ...settings, proactiveExecution: false }, fresh).execute).toEqual([]);
  });
});
