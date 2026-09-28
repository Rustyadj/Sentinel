// @vitest-environment node
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { getSystemOneSummary, recordDecision, recordTimeToFirstAudio, RequestTrace, type DecisionRecord } from "@/lib/system-one/telemetry";
import type { SystemOneResult } from "@/lib/system-one/types";
import { confidentToolDecision } from "./fixtures";

// The run database is cloned from a template built before this table existed;
// apply this change's own migration to it, exactly as a deploy would.
beforeAll(async () => {
  const sql = readFileSync(join(process.cwd(), "prisma/migrations/20260926120000_system_one_decisions/migration.sql"), "utf8");
  const statements = sql.split(";").map((s) => s.replace(/--.*$/gm, "").trim()).filter(Boolean);
  const exists = await db.$queryRawUnsafe<Array<{ n: bigint }>>(`SELECT count(*) AS n FROM information_schema.tables WHERE table_name = 'system_one_decisions'`);
  if (Number(exists[0].n) === 0) for (const statement of statements) await db.$executeRawUnsafe(statement);
});

const USER = "s1-telemetry-user";
const ok = (latencyMs: number, confidence = 0.95): SystemOneResult => ({
  outcome: "ok", decision: confidentToolDecision({ confidence }), provider: "jev", providerModel: "jev-1.13", latencyMs, inputTokens: 500, costUsd: 0.00002,
});

function record(overrides: Partial<DecisionRecord>): DecisionRecord {
  return {
    surface: "voice", agentId: "hermes-nathan2", userId: USER, mode: "shadow", result: ok(100), plan: null,
    executedPath: "system2", system2Invoked: true, trace: new RequestTrace(), ...overrides,
  };
}

describe("System 1 telemetry", () => {
  beforeEach(async () => {
    await db.systemOneDecision.deleteMany({ where: { userId: { startsWith: "s1-" } } });
  });

  it("estimates avoided tokens from the agent's own recent System 2 turns", async () => {
    await recordDecision(record({ system2: { model: "gpt-5.6-sol", inputTokens: 3000, outputTokens: 200, tools: ["operational_status"] } }));
    await recordDecision(record({ system2: { model: "gpt-5.6-sol", inputTokens: 1000, outputTokens: 0, tools: [] } }));
    const id = await recordDecision(record({ mode: "active", executedPath: "fast_path_tool", system2Invoked: false, tool: { id: "mobileops.operational_status", ok: true, latencyMs: 150 } }));

    const row = await db.systemOneDecision.findUniqueOrThrow({ where: { id: id! } });
    expect(row.system2Avoided).toBe(true);
    expect(row.estTokensAvoided).toBe(2100); // avg(3200, 1000)
    // gpt-5.6-sol is on the rate card: 2000 in × $4/M + 100 out × $20/M.
    expect(row.estCostAvoidedUsd).toBeCloseTo(0.01, 6);
  });

  it("leaves savings in dollars null for a model with no rate card, never a guessed zero", async () => {
    await recordDecision(record({ system2: { model: "gpt-5.6-luna", inputTokens: 3000, outputTokens: 200, tools: [] } }));
    await recordDecision(record({ mode: "active", executedPath: "fast_path_tool", system2Invoked: false }));
    const summary = await getSystemOneSummary({ userId: USER });
    expect(summary.system2CallsAvoided).toBe(1);
    expect(summary.estTokensAvoided).toBe(3200);
    expect(summary.estCostAvoidedUsd).toBeNull();
    expect(summary.netSavingsUsd).toBeNull();
  });

  it("summarises latency percentiles, fallback rate, Jev cost and shadow tool agreement", async () => {
    for (const ms of [80, 90, 100, 110, 400]) {
      await recordDecision(record({ result: ok(ms), plan: { action: "fast_path_tool", tier: "high", tool: null, toolArguments: {}, reasons: [] }, system2: { model: null, inputTokens: 0, outputTokens: 0, tools: ms === 400 ? ["inventory_search"] : ["operational_status"] } }));
    }
    await recordDecision(record({ result: { ...ok(250), outcome: "timeout", decision: null, costUsd: null } }));

    const s = await getSystemOneSummary({ userId: USER });
    expect(s.requests).toBe(6);
    expect(s.s1.p50).toBe(100);
    expect(s.s1.p95).toBe(400);
    expect(s.fallbackRate).toBeCloseTo(1 / 6);
    expect(s.s1.costUsd).toBeCloseTo(0.0001);
    // 4 of the 5 shadow fast-path suggestions matched the tool System 2 really used.
    expect(s.shadowToolAgreement).toEqual({ comparable: 5, agreed: 4, rate: 0.8 });
  });

  it("accepts time-to-first-audio once, and only from the row's owner", async () => {
    const id = (await recordDecision(record({})))!;
    expect(await recordTimeToFirstAudio(id, "s1-someone-else", 900)).toBe(false);
    expect(await recordTimeToFirstAudio(id, USER, 900)).toBe(true);
    expect(await recordTimeToFirstAudio(id, USER, 100)).toBe(false);
    expect((await db.systemOneDecision.findUniqueOrThrow({ where: { id } })).ttfaMs).toBe(900);
  });
});
